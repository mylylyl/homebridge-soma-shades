import { API, APIEvent, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ShadesAccessory } from './platformAccessory';

import noble from '@abandonware/noble';
import { SOMADevice } from './somaDevice';

export interface SOMAShadesPlatformConfig extends PlatformConfig {
	devices: [{
		name: string;
		id: string;
	}];
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

	constructor(
		public readonly log: Logger,
		public readonly config: PlatformConfig,
		public readonly api: API,
	) {
		this.log.debug('Finished initializing platform:', this.config.name);

		// When this event is fired it means Homebridge has restored all cached accessories from disk.
		// Dynamic Platform plugins should only register new accessories after this event was fired,
		// in order to ensure they weren't added to homebridge already. This event can also be used
		// to start discovery of new accessories.
		this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
			log.debug('Executed didFinishLaunching callback');
			// run the method to discover / register your devices as accessories
			this.discoverDevices();
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

	discoverDevices() {
		// remove unconfigured accessories first
		if (!this.config || !(this.config as SOMAShadesPlatformConfig).devices || (this.config as SOMAShadesPlatformConfig).devices.length <= 0) {
			this.log.error('invalid config, removing all accessories');
			this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
		}

		for (const accessory of this.accessories) {
			if (!(this.config as SOMAShadesPlatformConfig).devices.find((config) => config.id === accessory.context.device.id)) {
				this.log.info('%s is not configured, removing...', accessory.displayName);
			}
		}

		const discoveredDevices: Array<string> = [];

		noble.on('discover', (peripharel) => {
			const peripharelId = peripharel.id.toLowerCase();

			if (discoveredDevices.includes(peripharelId)) {
				this.log.debug('peripheral %s already discovered', peripharelId);
			} else {
				const deviceConfig = (this.config as SOMAShadesPlatformConfig).devices.find((config) => config.id.toLowerCase() === peripharelId);
				if (!deviceConfig) {
					this.log.debug('peripheral %s is not configured', peripharelId);
				} else {
					this.log.debug('discovered peripheral %s, adding to accessories', peripharelId);
					discoveredDevices.push(peripharelId);
					this.addAccessory(deviceConfig, peripharel);

					if (discoveredDevices.length === (this.config as SOMAShadesPlatformConfig).devices.length) {
						this.log.debug('discovered all peripherals, exiting...');
						noble.stopScanningAsync();
					}
				}
			}
		});

		this.log.debug('start noble scanning');
		noble.startScanningAsync();
	}

	addAccessory(deviceConfig: { name: string; id: string }, peripharel: noble.Peripheral) {
		const uuid = this.api.hap.uuid.generate(deviceConfig.id);

		const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

		if (existingAccessory) {
			// the accessory already exists
			this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);

			new ShadesAccessory(this, existingAccessory, new SOMADevice(this.log, peripharel));

			// update accessory cache with any changes to the accessory details and information
			this.api.updatePlatformAccessories([existingAccessory]);
		} else {
			// the accessory does not yet exist, so we need to create it
			this.log.debug('Adding new accessory:', deviceConfig.name);

			// create a new accessory
			const accessory = new this.api.platformAccessory(deviceConfig.name, uuid);

			// store a copy of the device object in the `accessory.context`
			// the `context` property can be used to store any data about the accessory you may need
			accessory.context.device = deviceConfig;

			// create the accessory handler for the newly create accessory
			// this is imported from `platformAccessory.ts`
			new ShadesAccessory(this, accessory, new SOMADevice(this.log, peripharel));

			// link the accessory to your platform
			this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
		}
	}
}
