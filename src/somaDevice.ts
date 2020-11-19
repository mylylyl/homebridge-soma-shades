import { Logger } from 'homebridge';
import noble from '@abandonware/noble';

// device information
const INFO_SERVICE_UUID = '180a';
const INFO_MANUFACTURER_CHARACTERISTIC_UUID = '2a29';
const INFO_SERIAL_CHARACTERISTIC_UUID = '2a25';
const INFO_HARDWARE_REVISION_CHARACTERISTIC_UUID = '2a27';
const INFO_FIRMWARE_REVISION_CHARACTERISTIC_UUID = '2a26';
const INFO_SOFTWARE_REVISION_CHARACTERISTIC_UUID = '2a28';
// battery
//const BATTERY_SERVICE_UUID = '180f';
//const BATTERY_CHARACTERISTIC_UUID = '2a19';
// motor control
const MOTOR_SERVICE_UUID = '00001861b87f490c92cb11ba5ea5167c';
const MOTOR_STATE_CHARACTERISTIC_UUID = '00001525b87f490c92cb11ba5ea5167c';
const MOTOR_TARGET_CHARACTERISTIC_UUID = '00001526b87f490c92cb11ba5ea5167c';
const MOTOR_CONTROL_CHARACTERISTIC_UUID = '00001530b87f490c92cb11ba5ea5167c';
//const MOTOR_MOVE_UP = 0x69;
const MOTOR_STOP = 0x50;
//const MOTOR_MOVE_DOWN = 0x96;
// timeout
const DEFAULT_TIMEOUT = 10000; // 10s

export interface SOMADeviceInformation {
	manufacturer: string;
	serial: string;
	hardwareRevision: string;
	firmwareRevision: string;
	softwareRevision: string;
}

export class SOMADevice {
	private log: Logger;
	private peripheral: noble.Peripheral;

	private characteristics: {
		battery: noble.Characteristic | null;
		motor: {
			state: noble.Characteristic | null;
			target: noble.Characteristic | null;
			control: noble.Characteristic | null;
		};
	};

	private connected = false;
	private initialized = false;

	constructor(log: Logger, peripheral: noble.Peripheral) {
		this.log = log;
		this.peripheral = peripheral;

		this.characteristics = {
			battery: null,
			motor: {
				state: null,
				target: null,
				control: null,
			},
		};
	}

	public connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Check the connection state
			const state = this.peripheral.state;
			if (state === 'connected') {
				this.connected = true;
				resolve();
				return;
			} else if (state === 'connecting' || state === 'disconnecting') {
				reject(new Error('current state is ' + state + '. Wait for a few seconds then try again.'));
				return;
			}

			// Set event handlers
			this.peripheral.once('connect', () => {
				this.log.debug('peripheral connected');
				this.connected = true;
			});

			this.peripheral.once('disconnect', () => {
				this.log.debug('peripheral disconnected');
				this.connected = false;
				this.peripheral.removeAllListeners();
			});

			this.peripheral.connectAsync().then(() => {
				this.connected = true;
				this.log.debug('successfully connect to device');
				return this.getCharacteristics();
			}).then(() => {
				if (this.initialized) {
					this.log.debug('device characteristics is initialized');
					resolve();
				} else {
					reject(new Error('failed to initialize characteristics'));
				}
			}).catch((error) => {
				reject(error);
			});
		});
	}

	async getInfomationCharacteristics(): Promise<SOMADeviceInformation> {
		if (!this.connected) {
			return this.connect().then(() => this.getInfomationCharacteristics());
		}

		this.log.debug('getting information characteristics');

		const deviceInfo: SOMADeviceInformation = {
			manufacturer: 'Default Manufacturer',
			serial: 'Default Serial',
			hardwareRevision: 'Default Hardware Revision',
			firmwareRevision: 'Default Firmware Revision',
			softwareRevision: 'Default Software Revision',
		};

		const services = await this.peripheral.discoverServicesAsync([INFO_SERVICE_UUID]);
		if (!services || services.length !== 1 || services[0].uuid !== INFO_SERVICE_UUID) {
			this.log.error('Invalid service discovered');
			return deviceInfo;
		}

		const characteristics = await services[0].discoverCharacteristicsAsync();
		if (!characteristics || characteristics.length <= 0) {
			this.log.error('Invalid characteristics discovered');
			return deviceInfo;
		}

		for (const characteristic of characteristics) {
			switch (characteristic.uuid) {
				case INFO_MANUFACTURER_CHARACTERISTIC_UUID:
					deviceInfo.manufacturer = (await characteristic.readAsync()).toString();
					break;
				case INFO_SERIAL_CHARACTERISTIC_UUID:
					deviceInfo.serial = (await characteristic.readAsync()).toString();
					break;
				case INFO_HARDWARE_REVISION_CHARACTERISTIC_UUID:
					deviceInfo.hardwareRevision = (await characteristic.readAsync()).toString();
					break;
				case INFO_FIRMWARE_REVISION_CHARACTERISTIC_UUID:
					deviceInfo.firmwareRevision = (await characteristic.readAsync()).toString();
					break;
				case INFO_SOFTWARE_REVISION_CHARACTERISTIC_UUID:
					deviceInfo.softwareRevision = (await characteristic.readAsync()).toString();
					break;
				default:
					break;
			}
		}

		return deviceInfo;
	}

	private async getCharacteristics(): Promise<void> {
		if (this.initialized) {
			this.log.debug('characteristics is inisitalized already');
			return;
		}

		const services = await this.peripheral.discoverServicesAsync([MOTOR_SERVICE_UUID]);
		if (!services || services.length !== 1 || services[0].uuid !== MOTOR_SERVICE_UUID) {
			this.log.error('Invalid motor services: %s', services.toString());
			return;
		}

		const motorCharacteristics = await services[0].discoverCharacteristicsAsync([MOTOR_STATE_CHARACTERISTIC_UUID, MOTOR_TARGET_CHARACTERISTIC_UUID, MOTOR_CONTROL_CHARACTERISTIC_UUID]);
		if (!motorCharacteristics || motorCharacteristics.length !== 3) {
			this.log.error('Invalid motor characteristics');
			return;
		}

		for (const characteristic of motorCharacteristics) {
			switch (characteristic.uuid) {
				case MOTOR_STATE_CHARACTERISTIC_UUID:
					this.log.debug('set motor state characteristic');
					this.characteristics.motor.state = characteristic;
					break;
				case MOTOR_TARGET_CHARACTERISTIC_UUID:
					this.log.debug('set motor target characteristic');
					this.characteristics.motor.target = characteristic;
					break;
				case MOTOR_CONTROL_CHARACTERISTIC_UUID:
					this.log.debug('set motor control characteristic');
					this.characteristics.motor.control = characteristic;
					break;
				default:
					break;
			}
		}

		this.log.debug('successfully get characteristics');
		this.initialized = true;
	}

	async getCurrentPosition(): Promise<number> {
		if (!this.connected) {
			this.log.error('[getCurrentPosition] Peripheral not connected');
			return this.connect().then(() => this.getCurrentPosition()).catch((error) => {
				this.log.error('[getCurrentPosition] failed to get position after trying to reconnect: %s', error);
				return 0;
			});
		}

		if (!this.initialized) {
			this.log.error('[getCurrentPosition] Peripheral characteristics not initialized');
			return this.getCharacteristics().then(() => this.getCurrentPosition()).catch((error) => {
				this.log.error('[getCurrentPosition] failed to get position after trying to get characteristics: %s', error);
				return 0;
			});
		}

		if (!this.characteristics.motor.state) {
			this.log.error('[getCurrentPosition] Peripheral characteristics.motor.target is invalid');
			return 0;
		}

		return Promise.race([
			await this.characteristics.motor.state.readAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('[getCurrentPosition] timed out')), DEFAULT_TIMEOUT)),
		]).then((buf) => {
			if (buf instanceof Buffer) {
				this.log.debug('[getCurrentPosition] return buf as buffer');
				return (buf as Buffer)[0];
			}
			this.log.debug('[getCurrentPosition] return buf as 0');
			return 0;
		}).catch((error) => {
			this.log.error('[getCurrentPosition] error: %s', error);
			return 0;
		});
	}

	async getTargetPosition(): Promise<number> {
		if (!this.connected) {
			this.log.error('[getTargetPosition] Peripheral not connected');
			return this.connect().then(() => this.getTargetPosition()).catch((error) => {
				this.log.error('[getTargetPosition] failed to get position after trying to reconnect: %s', error);
				return 0;
			});
		}

		if (!this.initialized) {
			this.log.error('[getTargetPosition] Peripheral characteristics not initialized');
			return this.getCharacteristics().then(() => this.getTargetPosition()).catch((error) => {
				this.log.error('[getTargetPosition] failed to get position after trying to get characteristics: %s', error);
				return 0;
			});
		}

		if (!this.characteristics.motor.target) {
			this.log.error('[getTargetPosition] Peripheral characteristics.motor.target is invalid');
			return 0;
		}

		return Promise.race([
			await this.characteristics.motor.target.readAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('[getTargetPosition] timed out')), DEFAULT_TIMEOUT)),
		]).then((buf) => {
			if (buf instanceof Buffer) {
				this.log.debug('[getTargetPosition] return buf as buffer');
				return (buf as Buffer)[0];
			}
			this.log.error('[getTargetPosition] return buf as 0');
			return 0;
		}).catch((error) => {
			this.log.error('[getTargetPosition] error: %s', error);
			return 0;
		});
	}

	async setTargetPosition(position: number): Promise<void> {
		if (!this.connected) {
			this.log.error('[setTargetPosition] Peripheral not connected');
			return this.connect().then(() => this.setTargetPosition(position)).catch((error) => {
				this.log.error('[setTargetPosition] failed to set position after trying to reconnect: %s', error);
			});
		}

		if (!this.initialized) {
			this.log.error('[setTargetPosition] Peripheral characteristics not initialized');
			return this.getCharacteristics().then(() => this.setTargetPosition(position)).catch((error) => {
				this.log.error('[setTargetPosition] failed to set position after trying to get characteristics: %s', error);
			});
		}

		if (!this.characteristics.motor.target) {
			this.log.error('[setTargetPosition] Peripheral characteristics.motor.target is invalid');
			return;
		}

		Promise.race([
			await this.characteristics.motor.target.writeAsync(Buffer.from([position]), false),
			new Promise((_, reject) => setTimeout(() => reject(new Error('[setTargetPosition] timed out')), DEFAULT_TIMEOUT)),
		]).catch((error) => this.log.error('[setTargetPosition] error: %s', error));
	}

	async setMotorStop(): Promise<void> {
		if (!this.connected) {
			this.log.error('[setMotorStop] Peripheral not connected');
			return this.connect().then(() => this.setMotorStop()).catch((error) => {
				this.log.error('[setMotorStop] failed to set motor stop after trying to reconnect: %s', error);
			});
		}

		if (!this.initialized) {
			this.log.error('[setMotorStop] Peripheral characteristics not initialized');
			return this.getCharacteristics().then(() => this.setMotorStop()).catch((error) => {
				this.log.error('[setMotorStop] failed to set motor stop after trying to get characteristics: %s', error);
			});
		}

		if (!this.characteristics.motor.control) {
			this.log.error('[setMotorStop] Peripheral characteristics.motor.target is invalid');
			return;
		}

		Promise.race([
			await this.characteristics.motor.control.writeAsync(Buffer.from([MOTOR_STOP]), false),
			new Promise((_, reject) => setTimeout(() => reject(new Error('[setMotorStop] timed out')), DEFAULT_TIMEOUT)),
		]).catch((error) => this.log.error('[setMotorStop] error: %s', error));
	}

	public disconnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.connected = false;

			const state = this.peripheral.state;
			if (state === 'disconnected') {
				resolve();
				return;
			} else if (state === 'connecting' || state === 'disconnecting') {
				reject(new Error('Now ' + state + '. Wait for a few seconds then try again.'));
				return;
			}

			return this.peripheral.disconnectAsync();
		});
	}
}