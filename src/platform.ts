import { API, APIEvent, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ShadesAccessory } from './platformAccessory';

import noble from '@abandonware/noble';
import { SOMADevice } from './somaDevice';

export interface SOMAShadesDeviceConfig {
	name: string;
	id: string;
}

export interface SOMAShadesPlatformConfig extends PlatformConfig {
	discoverDelay: number;
	devices: Array<SOMAShadesDeviceConfig>;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SOMAShadesPlatform implements DynamicPlatformPlugin {
	public readonly Service: typeof Service = this.api.hap.Service;
	public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

	// this is used to track restored cached accessories
	public readonly accessories: PlatformAccessory[] = [];

	// let our callback know we stopped the scan
	private discoveredAll = false;

	constructor(
		public readonly log: Logger,
		public readonly config: PlatformConfig,
		public readonly api: API,
	) {
		this.log.debug('Finished initializing platform');

		// When this event is fired it means Homebridge has restored all cached accessories from disk.
		// Dynamic Platform plugins should only register new accessories after this event was fired,
		// in order to ensure they weren't added to homebridge already. This event can also be used
		// to start discovery of new accessories.
		this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
			this.log.debug('on DID_FINISH_LAUNCHING. Looking for new accessories');
			// run the method to discover / register your devices as accessories
			const discoveryDelay = (config as SOMAShadesPlatformConfig).discoverDelay;
			this.log.debug(`delay discovery for ${discoveryDelay} seconds`);
			setTimeout(() => this.discoverDevices(), discoveryDelay * 1000);
		});
	}

	/**
	 * This function is invoked when homebridge restores cached accessories from disk at startup.
	 * It should be used to setup event handlers for characteristics and update respective values.
	 */
	configureAccessory(accessory: PlatformAccessory) {
		this.log.debug('Loading accessory from cache:', accessory.displayName);

		// add the restored accessory to the accessories cache so we can track if it has already been registered
		this.accessories.push(accessory);
	}

	discoverDevices(): boolean {
		// check for config
		if (!this.config || !this.config.devices || (this.config as SOMAShadesPlatformConfig).devices.length === 0) {
			this.log.error('invalid config, removing all accessories');
			this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
			return false;
		}

		// remove invalid accessories
		// we're not removing it from cached this.accessories
		// because those invalid accessory will not be called with addAccessory
		for (const accessory of this.accessories) {
			if (!(this.config as SOMAShadesPlatformConfig).devices.find((config) => config.id.toLowerCase() === accessory.context.device.id.toLowerCase())) {
				this.log.info('%s is not configured, removing...', accessory.displayName);
				this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
			}
		}

		const that = this;

		const scanStopped = function() {
			if (!that.discoveredAll) {
				that.log.debug('we have not discovered all configured devices, restarting scan...');
				noble.removeAllListeners('discover');
				noble.on('discover', discoverPeripharels);
				noble.startScanningAsync([], false).catch((error) => {
					that.log.error(`failed to start noble scanning: ${error}`);
				});
			}
		};

		const discoveredDevices: Array<string> = [];
		const discoverPeripharels = function (peripharel: noble.Peripheral): boolean {
			if (that.discoveredAll) {
				that.log.debug('we have discovered all devices, removing listeners...');
				noble.removeAllListeners('discover');
				noble.removeListener('scanStop', scanStopped);
				noble.stopScanningAsync().catch((error) => {
					that.log.error(`failed to stop noble scanning: ${error}`);
				});
				return true;
			}

			const peripharelId = peripharel.id.toLowerCase();

			if (discoveredDevices.includes(peripharelId)) {
				that.log.debug(`peripheral ${peripharelId} has been discovered`);
				return true;
			}

			const deviceConfig = (that.config as SOMAShadesPlatformConfig).devices.find((config) => config.id.toLowerCase() === peripharelId);
			if (!deviceConfig) {
				that.log.debug(`peripheral ${peripharelId} is not in config`);
				return false;
			}

			that.log.info(`discovered peripheral ${peripharelId}, adding to accessories`);
			discoveredDevices.push(peripharelId);
			that.addAccessory(deviceConfig, peripharel);

			if (discoveredDevices.length === (that.config as SOMAShadesPlatformConfig).devices.length) {
				that.log.info('discovered all peripherals');
				that.discoveredAll = true;
				noble.removeAllListeners('discover');
				noble.removeListener('scanStop', scanStopped);
				noble.stopScanningAsync().catch((error) => {
					that.log.error(`failed to stop noble scanning: ${error}`);
				});
			}

			return true;
		};

		// note that soma devices doesn't support scan with service uuid
		const startDiscovery = function () {
			noble.once('scanStop', scanStopped);

			that.log.debug('start noble scanning');
			noble.on('discover', discoverPeripharels);
			noble.startScanningAsync([], false).catch((error) => {
				that.log.error(`failed to start noble scanning: ${error}`);
			});
		};

		if (noble.state !== 'poweredOn') {
			this.log.info('noble is not running. waiting for it to power on...');
			noble.once('stateChange', (state) => {
				if (state === 'poweredOn') {
					this.log.info('noble is powered on');
					startDiscovery();
				} else {
					this.log.error(`noble is not powered on but in ${state} state`);
				}
			});

			return true;
		}

		startDiscovery();
		return true;
	}

	addAccessory(deviceConfig: SOMAShadesDeviceConfig, peripheral: noble.Peripheral) {
		const uuid = this.api.hap.uuid.generate(deviceConfig.id);

		const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

		if (existingAccessory) {
			// the accessory already exists
			this.log.debug('restoring existing accessory from cache:', existingAccessory.displayName);

			new ShadesAccessory(this, existingAccessory, new SOMADevice(this.log, peripheral));

			// update accessory cache with any changes to the accessory details and information
			this.api.updatePlatformAccessories([existingAccessory]);
		} else {
			// the accessory does not yet exist, so we need to create it
			this.log.debug('adding new accessory:', deviceConfig.name);

			// create a new accessory
			const accessory = new this.api.platformAccessory(deviceConfig.name, uuid);

			// store a copy of the device object in the `accessory.context`
			// the `context` property can be used to store any data about the accessory you may need
			accessory.context.device = deviceConfig;

			// create the accessory handler for the newly create accessory
			// this is imported from `platformAccessory.ts`
			new ShadesAccessory(this, accessory, new SOMADevice(this.log, peripheral));

			// link the accessory to your platform
			this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
		}
	}
}
