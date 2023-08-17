<div align="center">
    <p align="center"><h2>I can't believe it's not Valeronoi</h2></p>
</div>

ICBINVOI is a companion service for Valetudo that renders ValetudoMap map data to raster graphics with Wifi strength data.

The Wifi strength data is continuously collected and improved while the robot is cleaning, and you can watch it real time on the map.

Incoming ValetudoMap Data is received via MQTT.
Rendered map images are published to MQTT and can optionally also be requested via HTTP (if enabled)

## Disclaimer

This is a fork of [ICantBelieveItsNotValetudo](https://github.com/Hypfer/ICantBelieveItsNotValetudo) and inspired on [Valeronoi](https://github.com/ccoors/Valeronoi)

## Why would I need this?

ICBINVOI Allows you to view a WIFI strength map of your house.

## Installation

The recommended install method for ICBINVOI is to clone the repo and then use the provided Dockerfile.

With docker-compose, it would look something like this:

```
  icantbelieveitsnotvaleronoi:
    build:
      context: ./ICantBelieveItsNotValeronoi/
      dockerfile: Dockerfile
    container_name: "ICantBelieveItsNotValeronoi"
    restart: always
    volumes:
      - /opt/docker_containers/ICantBelieveItsNotValeronoi/config:/app/config
```

If you have multiple robots, simply deploy multiple instances of ICBINVOI.


If you don't want to use docker, you will need to install a recent nodejs version + npm installed on your host.

First, install the dependencies with `npm ci`. Then, you can start the application by running `npm run start`.

## Configuration

To configure *I can't believe it's not Valeronoi*, create a file called `config.json` in the `app` inside the working directory.
You can also run `npm start` to automatically create a default configuration file.

If you are running in docker, map the configuration file to `/app/config/config.json` .

## Integration with FHEM, ioBroker, openHAB etc

Enabling the webserver in the configuration file will allow you to fetch the latest rendered map image via `http://host:port/api/map/image`.<br/>
The map will also be available as base64-encoded string at `http://host:port/api/map/base64`.

By default, the image data is published via MQTT to `mqtt.topicPrefix/mqtt.identifier/MapData/map` as a raw binary image.<br/>
If `mqtt.publishAsBase64` is set to `true`, the image data will instead be published as base64-encoded string, which can be useful for OpenHAB.
