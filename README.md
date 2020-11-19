
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Plugin for SOMA Shades

This is a homebridge plugin for SOMA Smart Shades.

Currently supported:
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
sudo npm install -g @fisherwise/homebridge-soma-shades
```
You can also install it on the homebridge plugins page.

## Configuration
You can configure it using [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x)

or add it manually
```json
{
    "devices": [
        {
            "name": "Balcony Shades",
            "id": "d542c4c9a705"
        }
    ],
    "platform": "SOMAShades"
}
```

## TODO
 - [ ] add a battery accessory for the shades




