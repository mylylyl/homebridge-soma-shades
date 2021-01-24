
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Plugin for SOMA Shades

This is a homebridge plugin for SOMA Smart Shades.

Currently supports:
* [Smart Shades 2](https://www.somasmarthome.com/)
* [Smart Shades (Not Tested)](https://www.somasmarthome.com/)


## Installation

### Install bluetooth libraries
##### Ubuntu, Debian, Raspbian
```sh
sudo apt install bluetooth bluez libbluetooth-dev libudev-dev
```
See the document of the [@abandonware/noble](https://github.com/abandonware/noble#readme) for other operating systems details.

### Install package
```sh
sudo npm install -g homebridge-soma-shades
```
You can also install it on the homebridge plugins page.

## Configuration
You can configure it using [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x)
or add below to ```config.json``` manually
```json
{
    "devices": [
        {
            "name": "Balcony Shades",
            "id": "CHANGE ME TO YOUR SHADES MAC ADDRESS WITHOUT COLON"
        }
    ],
    "platform": "SOMAShades"
}
```

## TODO
 - [x] add a battery accessory for the shades
 - [ ] correctly read charging state
 - [ ] set polling rate through config


## Known Issue
### TypeError: Cannot set property 'mtu' of undefined
See abandonware/noble#164




