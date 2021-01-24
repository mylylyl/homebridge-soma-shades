import {
	Service,
	PlatformAccessory,
	CharacteristicValue,
	CharacteristicEventTypes,
	CharacteristicSetCallback,
	CharacteristicGetCallback,
} from 'homebridge';

import { SOMAShadesPlatform } from './platform';

import { SOMADevice } from './somaDevice';

// battery level below 10% is considered low battery
const LOW_BATTERY_LEVEL = 10;

// refresh every 10 seconds
// TODO: set through configuration
const REFRESH_RATE = 10;

// dummy replica of HAP.PositionState
enum POSITION_STATE {
	DECREASING = 0,
	INCREASING = 1,
	STOPPED = 2,
}

// dummy replica of HAP.ChargingState
enum CHARGING_STATE {
	NOT_CHARGING = 0,
	CHARGING = 1,
	NOT_CHARGEABLE = 2
}

// dummy replica of HAP.LowBattery
enum LOW_BATTERY {
	NORMAL = 0,
	LOW = 1
}

export class ShadesAccessory {
	private service: Service;
	private batteryService: Service;

	/**
	 * The HomeKit uses position as percentage from bottom to top. 0 is bottom(fully closed) and 100 is top(fully open)
	 * whereas the shades uses the percentage from top to bottom where 100 is bottom(fully closed) and 0 is top(fully open)
	 * Here we regulate them to use "HomeKit Standard"
	 */
	private shadesState = {
		positionState: POSITION_STATE.STOPPED,
		currentPosition: 0,
		targetPosition: 0,
	};

	private batteryState = {
		level: 100,
		charging: CHARGING_STATE.NOT_CHARGEABLE,
		low_battery: LOW_BATTERY.NORMAL,
	};

	// last time we set target position
	private lastMovementDone = true;

	// we want to setup current & target position from device
	// but only at the first poll
	private firstPoll = true;

	constructor(
		private readonly platform: SOMAShadesPlatform,
		private readonly accessory: PlatformAccessory,
		private readonly somaDevice: SOMADevice,
	) {
		// set up window covering service
		this.service = this.accessory.getService(this.platform.Service.WindowCovering) || this.accessory.addService(this.platform.Service.WindowCovering);
		this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

		this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.shadesState.positionState);
		this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);
		this.service.getCharacteristic(this.platform.Characteristic.TargetPosition).updateValue(this.shadesState.targetPosition);
		this.service
			.getCharacteristic(this.platform.Characteristic.CurrentPosition)
			.on(CharacteristicEventTypes.GET, this.getCurrentPosition.bind(this));
		this.service
			.getCharacteristic(this.platform.Characteristic.PositionState)
			.on(CharacteristicEventTypes.GET, this.getPositionState.bind(this));
		this.service
			.getCharacteristic(this.platform.Characteristic.TargetPosition)
			.on(CharacteristicEventTypes.GET, this.getTargetPosition.bind(this))
			.on(CharacteristicEventTypes.SET, this.setTargetPosition.bind(this));

		// setup battery service
		this.batteryService = this.accessory.getService(this.platform.Service.BatteryService) || this.accessory.addService(this.platform.Service.BatteryService);
		this.batteryService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name + ' Battery');

		this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel).updateValue(this.batteryState.level);
		this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState).updateValue(this.batteryState.charging);
		this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery).updateValue(this.batteryState.low_battery);
		this.batteryService
			.getCharacteristic(this.platform.Characteristic.BatteryLevel)
			.on(CharacteristicEventTypes.GET, this.getBatteryLevel.bind(this));
		this.batteryService
			.getCharacteristic(this.platform.Characteristic.ChargingState)
			.on(CharacteristicEventTypes.GET, this.getChargingState.bind(this));
		this.batteryService
			.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
			.on(CharacteristicEventTypes.GET, this.getLowBatteryState.bind(this));

		// set accessory information
		this.somaDevice.getInfomationCharacteristics()
			.then((deviceInformation) => {
				this.platform.log.debug(`accessory ${this.accessory.displayName} successfully gets device information`);

				this.accessory.getService(this.platform.Service.AccessoryInformation)!
					.setCharacteristic(this.platform.Characteristic.Manufacturer, deviceInformation.manufacturer)
					.setCharacteristic(this.platform.Characteristic.Model, 'Smart Shades')
					.setCharacteristic(this.platform.Characteristic.SerialNumber, deviceInformation.serial)
					.setCharacteristic(this.platform.Characteristic.HardwareRevision, deviceInformation.hardwareRevision)
					.setCharacteristic(this.platform.Characteristic.SoftwareRevision, deviceInformation.softwareRevision)
					.setCharacteristic(this.platform.Characteristic.FirmwareRevision, deviceInformation.firmwareRevision);

				void this.poll();
			})
			.catch((error) => this.platform.log.error(`accessory ${this.accessory.displayName} failed to get device information: ${error}`));
	}

	private getBatteryLevel(callback: CharacteristicGetCallback) {
		callback(null, this.batteryState.level);
	}

	private getChargingState(callback: CharacteristicGetCallback) {
		callback(null, this.batteryState.charging);
	}

	private getLowBatteryState(callback: CharacteristicGetCallback) {
		callback(null, this.batteryState.low_battery);
	}

	private getPositionState(callback: CharacteristicGetCallback) {
		callback(null, this.shadesState.positionState);
	}

	private getCurrentPosition(callback: CharacteristicGetCallback) {
		callback(null, this.shadesState.currentPosition);
	}

	private getTargetPosition(callback: CharacteristicGetCallback) {
		callback(null, this.shadesState.targetPosition);
	}

	private setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
		if ((value as number) === this.shadesState.currentPosition) {
			this.platform.log.debug(`${this.accessory.displayName} failed to set position because shade is at ${value as number} already`);
			callback(null);
			return;
		}

		if (!this.lastMovementDone) {
			this.platform.log.debug(`${this.accessory.displayName} failed to set position because shade is still moving`);
			callback(null);
			return;
		}

		// update our vars
		this.shadesState.targetPosition = value as number;

		// figure out our moving dynamics.
		const moveUp = this.shadesState.targetPosition > this.shadesState.currentPosition;
		this.shadesState.positionState = moveUp ? POSITION_STATE.INCREASING : POSITION_STATE.DECREASING;

		// tell HomeKit we're on the move.
		this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.shadesState.positionState);

		this.platform.log.info(`moving ${this.accessory.displayName} ${moveUp ? 'up' : 'down'} to ${this.shadesState.targetPosition}`);

		// move to target, but first check target position on device
		// since our stored position are reversed we need to reverse them back
		this.somaDevice.getTargetPosition()
			.then((targetPosition) => {
				if (targetPosition !== (100 - this.shadesState.targetPosition)) {
					return this.somaDevice.setTargetPosition(100 - this.shadesState.targetPosition);
				}
			})
			.then(() => {
				this.platform.log.debug(`${this.accessory.displayName} successfully set target position ${this.shadesState.targetPosition}`);
				callback(null);
			})
			.catch((error) => {
				this.platform.log.error(`${this.accessory.displayName} failed to set target position: ${error}`);
				callback(new Error(error));
			});
	}

	private async poll() {
		// Loop forever.
		for (; ;) {
			this.platform.log.debug(`${this.accessory.displayName} started polling`);

			const initialized = await this.somaDevice.initialize().catch((error) => {
				this.platform.log.error(`${this.accessory.displayName} failed to initialize: ${error}`);
				return false;
			});
			if (!initialized) {
				await this.sleep(REFRESH_RATE);
				continue;
			}

			this.batteryState.level = await this.somaDevice.getBatteryLevel().catch((error) => {
				this.platform.log.error(`${this.accessory.displayName} failed to get battery level: ${error}`);
				return 0;
			});
			this.platform.log.debug(`setting ${this.accessory.displayName} battery level to ${this.batteryState.level}`);
			this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel).updateValue(this.batteryState.level);
		

			if (this.batteryState.level <= LOW_BATTERY_LEVEL) {
				this.batteryState.low_battery = LOW_BATTERY.LOW;
			} else {
				this.batteryState.low_battery = LOW_BATTERY.NORMAL;
			}
			this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery).updateValue(this.batteryState.low_battery);

			this.shadesState.currentPosition = 100 - (await this.somaDevice.getCurrentPosition().catch((error) => {
				this.platform.log.error(`${this.accessory.displayName} failed to get current position: ${error}`);
				return 100;
			}));
			this.platform.log.debug(`updating ${this.accessory.displayName} current position to ${this.shadesState.currentPosition}`);
			this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);

			const targetPosition = 100 - (await this.somaDevice.getTargetPosition().catch((error) => {
				this.platform.log.error(`${this.accessory.displayName} failed to get target position: ${error}`);
				return 100;
			}));

			if (this.firstPoll) {
				this.shadesState.targetPosition = targetPosition;
				this.platform.log.debug(`updating ${this.accessory.displayName} target position to ${this.shadesState.targetPosition}`);
				this.service.getCharacteristic(this.platform.Characteristic.TargetPosition).updateValue(this.shadesState.targetPosition);
				this.firstPoll = false;
			}

			// eslint-disable-next-line max-len
			this.platform.log.debug(`${this.accessory.displayName} currentPosition ${this.shadesState.currentPosition} targetPosition ${this.shadesState.targetPosition} deviceTargetPosition ${targetPosition}`);

			if (this.shadesState.positionState !== POSITION_STATE.STOPPED) {
				this.platform.log.debug(`${this.accessory.displayName} is moving`);

				if (this.doneMoving(this.shadesState.currentPosition, this.shadesState.targetPosition, 2)) {
					this.platform.log.info(`${this.accessory.displayName} done moving, updating state`);
					this.lastMovementDone = true;
					this.shadesState.positionState = POSITION_STATE.STOPPED;
					this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.shadesState.positionState);
				}
			}

			this.platform.log.debug(`${this.accessory.displayName} done polling`);

			// Sleep until our next update.
			await this.sleep(REFRESH_RATE);
		}
	}

	// the shades tends to move a little bit more than what we set
	private doneMoving(currentPosition: number, targetPosition: number, threshold: number): boolean {
		const lb = (targetPosition - threshold) >= 0 ? (targetPosition - threshold) : 0;
		const hb = (targetPosition + threshold) <= 100 ? (targetPosition + threshold) : 100;
		return currentPosition >= lb && currentPosition <= hb;
	}

	// Emulate a sleep function.
	private sleep(s: number): Promise<NodeJS.Timeout> {
		return new Promise(resolve => setTimeout(resolve, s * 1000));
	}

}
