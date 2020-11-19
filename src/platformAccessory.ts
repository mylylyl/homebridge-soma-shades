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

export class ShadesAccessory {
	private service: Service;

	/**
	 * The HomeKit uses position as percentage from bottom to top. 0 is bottom(fully closed) and 100 is top(fully open)
	 * whereas the shades uses the percentage from top to bottom where 100 is bottom(fully closed) and 0 is top(fully open)
	 * Here we regulate them to use "HomeKit Standard"
	 */
	private shadesState = {
		// Characteristic.PositionState.STOPPED
		positionState: 2,
		currentPosition: 0,
		targetPosition: 0,
	};

	private isSettingPosition = false;
	private isMoving = false;

	constructor(
		private readonly platform: SOMAShadesPlatform,
		private readonly accessory: PlatformAccessory,
		private readonly somaDevice: SOMADevice,
	) {

		this.service = this.accessory.getService(this.platform.Service.WindowCovering) || this.accessory.addService(this.platform.Service.WindowCovering);

		// set the service name, this is what is displayed as the default name on the Home app
		this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

		// set our initial states
		this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState).updateValue(this.shadesState.positionState);
		this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);
		this.service.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition).updateValue(this.shadesState.targetPosition);

		// Setup our event listeners.
		this.service
			.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
			.on(CharacteristicEventTypes.GET, this.getCurrentPosition.bind(this));

		this.service
			.getCharacteristic(this.platform.api.hap.Characteristic.PositionState)
			.on(CharacteristicEventTypes.GET, this.getPositionState.bind(this));

		this.service
			.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
			.on(CharacteristicEventTypes.GET, this.getTargetPosition.bind(this))
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			.on(CharacteristicEventTypes.SET, this.setTargetPosition.bind(this));

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

	// Get the current window covering state.
	private getPositionState(callback: CharacteristicGetCallback): void {
		callback(undefined, this.shadesState.positionState);
	}

	// Get the current window covering state.
	private getCurrentPosition(callback: CharacteristicGetCallback): void {
		callback(undefined, this.shadesState.currentPosition);
	}

	// Get the target window covering state.
	private getTargetPosition(callback: CharacteristicGetCallback): void {
		callback(undefined, this.shadesState.targetPosition);
	}

	// Set the target window covering state and execute the action.
	private async setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
		this.platform.log.debug('setting target position to %d', value as number);
		this.isSettingPosition = true;

		this.platform.log.debug('stopping motor');
		await this.somaDevice.setMotorStop();
		this.isMoving = false;
		this.platform.log.debug('motor stopped');

		// update the state
		this.shadesState.positionState = this.platform.api.hap.Characteristic.PositionState.STOPPED;
		this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState).updateValue(this.shadesState.positionState);

		// just in case our shades was moving and it's moved to exactly where we want it to be...
		let currentPosition = await this.somaDevice.getCurrentPosition();
		// reverse the position we receive from the shades
		currentPosition = 100 - currentPosition;

		// We're already where we want to be, do nothing.
		if ((value as number) === currentPosition) {
			this.platform.log.debug('we are at where we want, skipping');

			this.shadesState.currentPosition = (value as number);
			this.shadesState.targetPosition = (value as number);

			this.service.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition).updateValue(this.shadesState.targetPosition);
			this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);

			this.isSettingPosition = false;
			callback(null);
			return;
		}

		// Figure out our move dynamics.
		const moveUp = value > currentPosition;
		this.shadesState.targetPosition = value as number;
		this.shadesState.positionState = moveUp ? this.platform.api.hap.Characteristic.PositionState.INCREASING : this.platform.api.hap.Characteristic.PositionState.DECREASING;

		// Tell HomeKit we're on the move.
		this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState).updateValue(this.shadesState.positionState);

		this.platform.log.debug('%s: Moving %s.', this.accessory.displayName, moveUp ? 'up' : 'down');

		// move to target
		// since our stored position are reversed we need to reverse them back.
		await this.somaDevice.setTargetPosition(100 - this.shadesState.targetPosition);
		this.isMoving = true;

		this.platform.log.debug('done setting target position');
		this.isSettingPosition = false;
		callback(null);
	}

	private async poll() {
		// Loop forever.
		for (; ;) {
			this.platform.log.debug('refreshing...');

			if (this.isSettingPosition) {
				this.platform.log.debug('is setting position, continue...');
				continue;
			}

			// update target position just in case
			// someone else is setting the shades
			let targetPosition = await this.somaDevice.getTargetPosition();
			targetPosition = 100 - targetPosition;
			this.shadesState.targetPosition = targetPosition;

			let currentPosition = await this.somaDevice.getCurrentPosition();
			currentPosition = 100 - currentPosition;

			this.platform.log.debug('currentPosition %d targetPosition %d', currentPosition, this.shadesState.targetPosition);

			if (this.isMoving) {
				if (!this.doneMoving(currentPosition, this.shadesState.targetPosition, 2)) {
					// we want some quick update here
					this.platform.log.debug('quick update here');
					await this.sleep(1);
					continue;
				} else {
					this.platform.log.debug('finished moving, updating state and currentPosition');
					
					this.isMoving = false;
					this.shadesState.currentPosition = currentPosition;
					this.shadesState.positionState = this.platform.api.hap.Characteristic.PositionState.STOPPED;
					this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);
					this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState).updateValue(this.shadesState.positionState);
				}
			} else {
				if (this.shadesState.positionState !== this.platform.api.hap.Characteristic.PositionState.STOPPED) {
					// something is wrong
					this.platform.log.error('shade is not moving but position state is not stopped');
				} else {
					this.platform.log.debug('updating positions');
					this.shadesState.currentPosition = currentPosition;
					this.shadesState.targetPosition = currentPosition;
					this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition).updateValue(this.shadesState.currentPosition);
					this.service.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition).updateValue(this.shadesState.targetPosition);
				}
			}

			// Sleep until our next update.
			await this.sleep(10);
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
