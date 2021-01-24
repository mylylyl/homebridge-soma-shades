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
const BATTERY_SERVICE_UUID = '180f';
const BATTERY_LEVEL_CHARACTERISTIC_UUID = '2a19';
// motor control
const MOTOR_SERVICE_UUID = '00001861b87f490c92cb11ba5ea5167c';
const MOTOR_STATE_CHARACTERISTIC_UUID = '00001525b87f490c92cb11ba5ea5167c';
const MOTOR_TARGET_CHARACTERISTIC_UUID = '00001526b87f490c92cb11ba5ea5167c';
const MOTOR_CONTROL_CHARACTERISTIC_UUID = '00001530b87f490c92cb11ba5ea5167c';
//const MOTOR_MOVE_UP = 0x69;
//const MOTOR_STOP = 0x50;
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

	initialize(): Promise<boolean> {
		if (!this.connected) {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is not connected`);
			return this.connect().then(() => this.initialize());
		}

		if (!this.initialized) {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is not initialized`);
			return this.getCharacteristics().then(() => this.initialize());
		}

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} finished initialize`);
		return new Promise((resolve) => resolve(true));
	}

	private connect(): Promise<void> {
		// Check the connection state
		const state = this.peripheral.state;
		if (state === 'connected') {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is already connected`);
			this.connected = true;
			return new Promise((resolve) => resolve());
		}

		this.peripheral.once('disconnect', () => {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} disconnected`);
			this.peripheral.removeAllListeners();
			this.connected = false;
			this.initialized = false;
			this.characteristics = {
				battery: null,
				motor: {
					state: null,
					target: null,
					control: null,
				},
			};
		});

		return Promise.race([
			this.peripheral.connectAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then(() => {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is connected`);
			this.connected = true;
			return new Promise<void>(resolve => resolve());
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to connect ${error}`);
			return new Promise((_, reject) => reject(new Error(error)));
		});
	}

	async getInfomationCharacteristics(): Promise<SOMADeviceInformation> {
		if (!this.connected) {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is not connected to get info characteristics`);
			return this.initialize().then(() => this.getInfomationCharacteristics());
		}

		const deviceInfo: SOMADeviceInformation = {
			manufacturer: 'Default Manufacturer',
			serial: 'Default Serial',
			hardwareRevision: 'Default Hardware Revision',
			firmwareRevision: 'Default Firmware Revision',
			softwareRevision: 'Default Software Revision',
		};

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is getting information services`);

		const services: noble.Service[] = await Promise.race([
			this.peripheral.discoverServicesAsync([INFO_SERVICE_UUID]),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((ret) => {
			if (ret && Array.isArray(ret)) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is discovering info services as array`);
				return (ret as noble.Service[]);
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover info services as array`);
			return [];
		}).catch((error) => {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover info services: ${error}`);
			return [];
		});

		if (services.length !== 1 || services[0].uuid !== INFO_SERVICE_UUID) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid info services`);
			return deviceInfo;
		}

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is getting information characteristics`);

		const characteristics: noble.Characteristic[] = await Promise.race([
			services[0].discoverCharacteristicsAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((ret) => {
			if (ret && Array.isArray(ret)) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is discovering info characteristics as array`);
				return (ret as noble.Characteristic[]);
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover info characteristics as array`);
			return [];
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover info characteristics: ${error}`);
			return [];
		});

		if (characteristics.length !== 5) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid info characteristics`);
			return deviceInfo;
		}

		for (const characteristic of characteristics) {
			if (characteristic.uuid === INFO_MANUFACTURER_CHARACTERISTIC_UUID) {
				deviceInfo.manufacturer = await characteristic.readAsync()
					.then((buffer) => {
						if (buffer instanceof Buffer) {
							this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading INFO_MANUFACTURER_CHARACTERISTIC_UUID as buffer`);
							return buffer.toString();
						}
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_MANUFACTURER_CHARACTERISTIC_UUID as buffer`);
						return deviceInfo.manufacturer;
					}).catch((error) => {
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_MANUFACTURER_CHARACTERISTIC_UUID: ${error}`);
						return deviceInfo.manufacturer;
					});
				continue;
			}
			if (characteristic.uuid === INFO_SERIAL_CHARACTERISTIC_UUID) {
				deviceInfo.serial = await characteristic.readAsync()
					.then((buffer) => {
						if (buffer instanceof Buffer) {
							this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading INFO_SERIAL_CHARACTERISTIC_UUID as buffer`);
							return buffer.toString();
						}
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_SERIAL_CHARACTERISTIC_UUID as buffer`);
						return deviceInfo.manufacturer;
					}).catch((error) => {
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_SERIAL_CHARACTERISTIC_UUID: ${error}`);
						return deviceInfo.manufacturer;
					});
				continue;
			}
			if (characteristic.uuid === INFO_HARDWARE_REVISION_CHARACTERISTIC_UUID) {
				deviceInfo.hardwareRevision = await characteristic.readAsync()
					.then((buffer) => {
						if (buffer instanceof Buffer) {
							this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading INFO_HARDWARE_REVISION_CHARACTERISTIC_UUID as buffer`);
							return buffer.toString();
						}
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_HARDWARE_REVISION_CHARACTERISTIC_UUID as buffer`);
						return deviceInfo.manufacturer;
					}).catch((error) => {
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_HARDWARE_REVISION_CHARACTERISTIC_UUID: ${error}`);
						return deviceInfo.manufacturer;
					});
				continue;
			}
			if (characteristic.uuid === INFO_FIRMWARE_REVISION_CHARACTERISTIC_UUID) {
				deviceInfo.firmwareRevision = await characteristic.readAsync()
					.then((buffer) => {
						if (buffer instanceof Buffer) {
							this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading INFO_FIRMWARE_REVISION_CHARACTERISTIC_UUID as buffer`);
							return buffer.toString();
						}
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_FIRMWARE_REVISION_CHARACTERISTIC_UUID as buffer`);
						return deviceInfo.manufacturer;
					}).catch((error) => {
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_FIRMWARE_REVISION_CHARACTERISTIC_UUID: ${error}`);
						return deviceInfo.manufacturer;
					});
				continue;
			}
			if (characteristic.uuid === INFO_SOFTWARE_REVISION_CHARACTERISTIC_UUID) {
				deviceInfo.softwareRevision = await characteristic.readAsync()
					.then((buffer) => {
						if (buffer instanceof Buffer) {
							this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading INFO_SOFTWARE_REVISION_CHARACTERISTIC_UUID as buffer`);
							return buffer.toString();
						}
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_SOFTWARE_REVISION_CHARACTERISTIC_UUID as buffer`);
						return deviceInfo.manufacturer;
					}).catch((error) => {
						this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read INFO_SOFTWARE_REVISION_CHARACTERISTIC_UUID: ${error}`);
						return deviceInfo.manufacturer;
					});
				continue;
			}
		}

		return deviceInfo;
	}

	private async getCharacteristics(): Promise<void> {
		if (!this.connected) {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is not connected to get characteristics`);
			return this.connect().then(() => this.getCharacteristics());
		}

		if (this.initialized) {
			this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is initialized already`);
			return new Promise(resolve => resolve());
		}

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is getting services`);

		const services: noble.Service[] = await Promise.race([
			this.peripheral.discoverServicesAsync([BATTERY_SERVICE_UUID, MOTOR_SERVICE_UUID]),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((ret) => {
			if (ret && Array.isArray(ret)) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is discovering services as array`);
				return (ret as noble.Service[]);
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover services as array`);
			return [];
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover services: ${error}`);
			return [];
		});

		if (services.length !== 2 || services[0].uuid !== BATTERY_SERVICE_UUID || services[1].uuid !== MOTOR_SERVICE_UUID) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid services`);
			return new Promise((_, reject) => reject(new Error('invalid services')));
		}

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is getting battery characteristics`);

		const batteryCharacteristics: noble.Characteristic[] = await Promise.race([
			services[0].discoverCharacteristicsAsync([BATTERY_LEVEL_CHARACTERISTIC_UUID]),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((ret) => {
			if (ret && Array.isArray(ret)) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is discovering battery characteristics as array`);
				return (ret as noble.Characteristic[]);
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover battery characteristics as array`);
			return [];
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover battery characteristics: ${error}`);
			return [];
		});

		if (batteryCharacteristics.length !== 1 || batteryCharacteristics[0].uuid !== BATTERY_LEVEL_CHARACTERISTIC_UUID) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid battery characteristics`);
			return new Promise((_, reject) => reject(new Error('invalid battery characteristics')));
		}

		this.characteristics.battery = batteryCharacteristics[0];

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is getting motor characteristics`);

		const motorCharacteristics: noble.Characteristic[] = await Promise.race([
			services[1].discoverCharacteristicsAsync([MOTOR_STATE_CHARACTERISTIC_UUID, MOTOR_TARGET_CHARACTERISTIC_UUID, MOTOR_CONTROL_CHARACTERISTIC_UUID]),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((ret) => {
			if (ret && Array.isArray(ret)) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is discovering motor characteristics as array`);
				return (ret as noble.Characteristic[]);
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover motor characteristics as array`);
			return [];
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to discover motor characteristics: ${error}`);
			return [];
		});
		
		if (motorCharacteristics.length !== 3) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid motor characteristics`);
			return new Promise((_, reject) => reject(new Error('invalid motor characteristics')));
		}

		for (const characteristic of motorCharacteristics) {
			switch (characteristic.uuid) {
				case MOTOR_STATE_CHARACTERISTIC_UUID:
					this.characteristics.motor.state = characteristic;
					break;
				case MOTOR_TARGET_CHARACTERISTIC_UUID:
					this.characteristics.motor.target = characteristic;
					break;
				case MOTOR_CONTROL_CHARACTERISTIC_UUID:
					this.characteristics.motor.control = characteristic;
					break;
				default:
					break;
			}
		}

		this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} has successfully get all characteristics`);
		this.initialized = true;

		return new Promise(resolve => resolve());
	}

	getBatteryLevel(): Promise<number> {
		if (!this.connected) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not connected for getBatteryLevel`);
			return this.initialize().then(() => this.getBatteryLevel());
		}

		if (!this.initialized) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not initialized for getBatteryLevel`);
			return this.getCharacteristics().then(() => this.getBatteryLevel());
		}

		if (!this.characteristics.battery) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid battery characteristic`);
			return new Promise((_, reject) => reject(new Error('invalid battery characteristic')));
		}

		return Promise.race([
			this.characteristics.battery.readAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((buffer) => {
			if (buffer instanceof Buffer) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading battery as buffer`);
				return buffer[0];
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read battery as buffer`);
			return new Promise<number>((_, reject) => reject(new Error('failed to read as buffer')));
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read battery: ${error}`);
			return new Promise((_, reject) => reject(new Error(error)));
		});
	}

	getCurrentPosition(): Promise<number> {
		if (!this.connected) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not connected for getCurrentPosition`);
			return this.initialize().then(() => this.getCurrentPosition());
		}

		if (!this.initialized) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not initialized for getCurrentPosition`);
			return this.getCharacteristics().then(() => this.getCurrentPosition());
		}

		if (!this.characteristics.motor.state) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid current position characteristic`);
			return new Promise((_, reject) => reject(new Error('invalid current position characteristic')));
		}

		return Promise.race([
			this.characteristics.motor.state.readAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((buffer) => {
			if (buffer instanceof Buffer) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading current position as buffer`);
				return buffer[0];
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read current position as buffer`);
			return new Promise<number>((_, reject) => reject(new Error('failed to read as buffer')));
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read current position: ${error}`);
			return new Promise((_, reject) => reject(new Error(error)));
		});
	}

	async getTargetPosition(): Promise<number> {
		if (!this.connected) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not connected for getTargetPosition`);
			return this.initialize().then(() => this.getTargetPosition());
		}

		if (!this.initialized) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not initialized for getTargetPosition`);
			return this.getCharacteristics().then(() => this.getTargetPosition());
		}

		if (!this.characteristics.motor.target) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid target position characteristic`);
			return new Promise((_, reject) => reject(new Error('invalid target position characteristic')));
		}

		return Promise.race([
			this.characteristics.motor.target.readAsync(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then((buffer) => {
			if (buffer instanceof Buffer) {
				this.log.debug(`peripheral ${this.peripheral.id.toLowerCase()} is reading target position as buffer`);
				return buffer[0];
			}
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read target position as buffer`);
			return new Promise<number>((_, reject) => reject(new Error('failed to read as buffer')));
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to read target position: ${error}`);
			return new Promise((_, reject) => reject(new Error(error)));
		});
	}

	setTargetPosition(position: number): Promise<void> {
		if (!this.connected) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not connected for setTargetPosition`);
			return this.initialize().then(() => this.setTargetPosition(position));
		}

		if (!this.initialized) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} is not initialized for setTargetPosition`);
			return this.getCharacteristics().then(() => this.setTargetPosition(position));
		}

		if (!this.characteristics.motor.target) {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} has invalid target position characteristic`);
			return new Promise((_, reject) => reject(new Error('invalid target position characteristic')));
		}

		return Promise.race([
			this.characteristics.motor.target.writeAsync(Buffer.from([position]), false),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), DEFAULT_TIMEOUT)),
		]).then(() => {
			return new Promise<void>(resolve => resolve());
		}).catch((error) => {
			this.log.error(`peripheral ${this.peripheral.id.toLowerCase()} failed to set target position: ${error}`);
			return new Promise((_, reject) => reject(new Error(error)));
		});
	}
}