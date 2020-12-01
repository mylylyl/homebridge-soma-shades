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

// 5 seconds before we can set another target position
const SET_INTERVAL = 5;

// dummy replica of HAP.PositionState
enum POSITION_STATE {
	DECREASING = 0,
	INCREASING = 1,
	STOPPED = 2,
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
		charging: 2, // not chargable
		low_battery: 0, // normal
	};

	// last time we set target position
	private lastSetTargetPositionTS = Date.now();

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
		this.somaDevice.getInfomationCharacteristics().then((deviceInformation) => {
			this.platform.log.debug('successfully get device information');

			this.accessory.getService(this.platform.Service.AccessoryInformation)!
				.setCharacteristic(this.platform.Characteristic.Manufacturer, deviceInformation.manufacturer)
				.setCharacteristic(this.platform.Characteristic.Model, 'Smart Shades')
				.setCharacteristic(this.platform.Characteristic.SerialNumber, deviceInformation.serial)
				.setCharacteristic(this.platform.Characteristic.HardwareRevision, deviceInformation.hardwareRevision)
				.setCharacteristic(this.platform.Characteristic.SoftwareRevision, deviceInformation.softwareRevision)
				.setCharacteristic(this.platform.Characteristic.FirmwareRevision, deviceInformation.firmwareRevision);

			void this.poll();
		}).catch((error) => this.platform.log.error('Failed to get device information: %s', error));
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
		this.platform.log.debug('try setting target position to %d', value as number);

		if ((value as number) === this.shadesState.currentPosition) {
			this.platform.log.debug('failed because we are where we want');
			callback(null);
			return;
		}

		if ((Date.now() - this.lastSetTargetPositionTS) * 1000 < SET_INTERVAL) {
			this.platform.log.debug('failed because we set to often');
			callback(null);
			return;
		}

		// update our vars
		this.lastSetTargetPositionTS = Date.now();
		this.shadesState.targetPosition = value as number;

		// figure out our moving dynamics.
		const moveUp = this.shadesState.targetPosition > this.shadesState.currentPosition;
		this.shadesState.positionState = moveUp ? POSITION_STATE.INCREASING : POSITION_STATE.DECREASING;

		// tell HomeKit we're on the move.
		this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.shadesState.positionState);
		this.platform.log.debug('%s: moving %s to %d', this.accessory.displayName, moveUp ? 'up' : 'down', this.shadesState.targetPosition);

		// move to target
		// since our stored position are reversed we need to reverse them back.
		this.somaDevice.setTargetPosition(100 - this.shadesState.targetPosition)
			.then(() => this.platform.log.debug('%s: successfully set target position', this.accessory.displayName))
			.catch((error) => this.platform.log.error('%s: failed to set target position: %s', this.accessory.displayName, error));

		callback(null);
	}

	private async poll() {
		// Loop forever.
		for (; ;) {
			this.platform.log.debug('refreshing...');

			this.batteryState.level = await this.somaDevice.getBatteryLevel();
			this.platform.log.debug('setting battery level to %d', this.batteryState.level);
			
			if (this.batteryState.level <= LOW_BATTERY_LEVEL) {
				this.batteryState.low_battery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
			} else {
				this.batteryState.low_battery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
			}

			let currentPosition = await this.somaDevice.getCurrentPosition();
			currentPosition = 100 - currentPosition;
			this.shadesState.currentPosition = currentPosition;
			this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);

			this.platform.log.debug('currentPosition %d targetPosition %d', this.shadesState.currentPosition, this.shadesState.targetPosition);

			if (this.shadesState.positionState !== POSITION_STATE.STOPPED) {
				if (this.doneMoving(this.shadesState.currentPosition, this.shadesState.targetPosition, 2)) {
					this.platform.log.debug('done moving, updating state');

					this.shadesState.positionState = POSITION_STATE.STOPPED;
					this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.shadesState.positionState);
				}
			}

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
