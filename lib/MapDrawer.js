const Canvas = require("@napi-rs/canvas");
const colorMap = require("colormap");
const fs = require("fs");
const path = require("path");
const Voronoi = require("./Rhill-voronoi-core");

const Logger = require("./Logger");

const voronoi = new Voronoi();

const imgRobot = new Canvas.Image();
imgRobot.src = fs.readFileSync(path.join(__dirname, "./res/robot.png"));

const imgCharger = new Canvas.Image();
imgCharger.src = fs.readFileSync(path.join(__dirname, "./res/charger.png"));


class MapDrawer {
    constructor(options) {
        this.settings = Object.assign({
            drawPath: true,
            drawCharger: true,
            drawRobot: true,
            scale: 4,
            rotate: 0,
            crop_left: 0,
            crop_top: 0,
            crop_right: 0,
            crop_bottom: 0,
            padding_left: 0,
            padding_top: 0,
            padding_right: 0,
            padding_bottom: 0,
            voronoi_color_scheme: "inferno",
        }, options.settings);

        const defaultColors = {
            obstacle: "#333333",
            path: "#ffffff",

            segments: ["#19A1A1", "#7AC037", "#DF5618", "#F7C841"]
        };
        this.colors = Object.assign(defaultColors, options.settings.colors);
        this.colors.obstacle = this.hexToRgba(this.colors.obstacle);
        this.colors.segments = this.colors.segments.map(this.hexToRgba);
        this.maxDb = -200;
        this.minDb = 200;
        this.wifiSignalLocations = this.getWifiSignalsFromCache();
        this.currentWifiSignal = undefined;
        this.currentWifiSignalTimestamp = 0;
        this.robotPosition = undefined;
        this.robotPositionTimestamp = 0;


        this.mapColors = colorMap({
            colormap: this.settings.voronoi_color_scheme,
            nshades: 100,
            format: "hex",
            alpha: 1
        });
    }


    getWifiSignalsFromCache() {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/wifiSignalLocations.json")).toString());
            this.maxDb = Math.max(...Object.values(data).map(({signal}) => signal));
            this.minDb = Math.min(...Object.values(data).map(({signal}) => signal));
            return data;
        } catch (e) {
            Logger.error(e);
        }
        return {};

    }


    updateWifiSignalLocations(wifiSignal) {
        if (wifiSignal >= -1) {
            return;
        }
        this.currentWifiSignal = wifiSignal;
        this.currentWifiSignalTimestamp = Date.now();
        this.addCurrentWifiSignalLocation();
    }

    updateRobotPosition(mapData) {
        const robotPositionEntity = mapData?.entities?.find(e => e.type === "robot_position");
        if (!robotPositionEntity){
            return;
        }
        this.robotPosition = {
            x: robotPositionEntity.points[0],
            y: robotPositionEntity.points[1],
        };
        this.robotPositionTimestamp = Date.now();
        this.addCurrentWifiSignalLocation();
    }

    addCurrentWifiSignalLocation() {
        if (!this.robotPosition || !this.currentWifiSignal) {
            return;
        }
        if (Math.abs(this.robotPositionTimestamp - this.currentWifiSignalTimestamp) > 10000){
            Logger.info("Skipping wifi signal location update time is outdated");
            return;
        }

        const normalizedX = Math.floor(this.robotPosition.x / 10)* 10;
        const normalizedY = Math.floor(this.robotPosition.y / 10)* 10;
        this.wifiSignalLocations[`${normalizedX}_${normalizedY}`] ={
            x: this.robotPosition.x,
            y: this.robotPosition.y,
            signal: this.currentWifiSignal,
            timestamp: Date.now()
        };
        if (this.maxDb < this.currentWifiSignal){
            this.maxDb = this.currentWifiSignal;
        }
        if (this.minDb > this.currentWifiSignal){
            this.minDb = this.currentWifiSignal;
        }
        this.robotPosition = null;
        this.currentWifiSignal = null;
        fs.writeFileSync(path.join(__dirname, "../config/wifiSignalLocations.json"), JSON.stringify(this.wifiSignalLocations));
    }

    updateMap(mapData) {
        if (mapData.metaData?.version === 2 && Array.isArray(mapData.layers)) {
            mapData.layers.forEach(layer => {
                if (layer.pixels.length === 0 && layer.compressedPixels.length !== 0) {
                    for (let i = 0; i < layer.compressedPixels.length; i = i + 3) {
                        const xStart = layer.compressedPixels[i];
                        const y = layer.compressedPixels[i+1];
                        const count = layer.compressedPixels[i+2];

                        for (let j = 0; j < count; j++) {
                            layer.pixels.push(
                                xStart + j,
                                y
                            );
                        }
                    }
                }
            });
        }


        this.bounds = {
            x1: Math.min(...mapData.layers.flatMap(layer => layer.dimensions.x.min)),
            x2: Math.max(...mapData.layers.flatMap(layer => layer.dimensions.x.max)),
            y1: Math.min(...mapData.layers.flatMap(layer => layer.dimensions.y.min)),
            y2: Math.max(...mapData.layers.flatMap(layer => layer.dimensions.y.max))
        };

        this.mapData = { ...mapData, layers: mapData.layers.map(layer => ({ ...layer, pixels: this.translatePixels(layer.pixels) })) };
        this.updateRobotPosition(this.mapData);
    }

    hexToRgba(hex) {
        try {
            return {
                r: parseInt(hex.slice(1, 3), 16),
                g: parseInt(hex.slice(3, 5), 16),
                b: parseInt(hex.slice(5, 7), 16),
                a: hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) : 255
            };
        } catch {
            Logger.error("Unable to parse hex color " + hex + "!");
            return { r: 0, g: 0, b: 0, a: 255 };
        }
    }

    rotateImage(img, angle) {
        const outImg = new Canvas.Image();
        const c = Canvas.createCanvas(img.width, img.height);
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, img.width, img.height);
        ctx.translate(img.width / 2, img.width / 2);
        ctx.rotate(angle * Math.PI / 180);
        ctx.translate(-img.width / 2, -img.width / 2);
        ctx.drawImage(img, 0, 0);

        outImg.src = c.encodeSync("png");
        return outImg;
    }

    cropAndPadCanvas (sourceCanvas,sx,sy,cropWidth,cropHeight,dx, dy, finalWidth, finalHeight) {
        let destCanvas = Canvas.createCanvas(finalWidth, finalHeight);
        destCanvas.getContext("2d").drawImage(
            sourceCanvas,
            sx,sy,cropWidth,cropHeight,
            dx,dy,cropWidth,cropHeight);
        return destCanvas;
    }

    createCanvas(width, height, rotate, scale) {
        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        if (rotate) {
            ctx.rotate(rotate * Math.PI / 180);
        }

        ctx.scale(scale, scale);

        return {
            canvas,
            ctx,
        };
    }

    drawVoronoi(ctx, scaledCanvasWidth, scaledCanvasHeight) {
        try {
            const bbox = { xl: 0, xr: scaledCanvasWidth, yt: 0, yb: scaledCanvasHeight };
            const values = Object.values(this.wifiSignalLocations);
            const points = values.map(({x,y}) => {
                const converted = this.translatePixels(this.translateCoordinatesToPixels([x,y]));
                return {
                    x: converted[0],
                    y: converted[1],
                };
            });

            const diagram = voronoi.compute(points, bbox);
            diagram.cells.forEach((cell, i) => {
                if (cell && cell.halfedges.length > 2) {
                    const segments = cell.halfedges.map(edge => edge.getEndpoint());
                    this.drawPolygon(ctx, segments.map(({x,y}) => [x, y]).flat(), this.getColorForSignal(values[i].signal));

                }
            });
        } catch (e) {
            Logger.error(e);
        }
    }

    draw() {
        if (!this.mapData || this.mapData.__class !== "ValetudoMap" || !this.mapData.metaData) {
            Logger.error("Unable to draw map: no or invalid map data!");
            return;
        }

        const canvasWidth = Math.max.apply(undefined, this.mapData.layers.flatMap(l => l.pixels.filter((_, index) => index % 2 === 0))) + 1;
        const canvasHeight = Math.max.apply(undefined, this.mapData.layers.flatMap(l => l.pixels.filter((_, index) => index % 2 === 1))) + 1;

        const scaledCanvasWidth = canvasWidth * this.settings.scale;
        const scaledCanvasHeight = canvasHeight * this.settings.scale;

        const { ctx: voronoiCtx } = this.createCanvas(scaledCanvasWidth, scaledCanvasHeight, this.settings.rotate, this.settings.scale);
        this.drawVoronoi(voronoiCtx, scaledCanvasWidth, scaledCanvasHeight);


        let { canvas: mapCanvas, ctx } = this.createCanvas(scaledCanvasWidth, scaledCanvasHeight, this.settings.rotate, this.settings.scale);
        this.drawLayers(ctx, scaledCanvasWidth, scaledCanvasHeight, voronoiCtx.getImageData(0,0, scaledCanvasWidth, scaledCanvasHeight)?.data);
        this.drawEntities(ctx);

        let rawImg;
        let base64Img;


        if (this.settings.crop_left === 0 && this.settings.crop_top === 0 && this.settings.crop_bottom === 0 && this.settings.crop_right === 0){
            rawImg = mapCanvas.toBuffer("image/png");
            base64Img = mapCanvas.toDataURL();
        } else {
            const cropWidth = mapCanvas.width - this.settings.crop_left - this.settings.crop_right;
            const cropHeight = mapCanvas.height - this.settings.crop_top - this.settings.crop_bottom;

            const finalWidth = cropWidth + this.settings.padding_right + this.settings.padding_left;
            const finalHeight = cropHeight + this.settings.padding_top + this.settings.padding_bottom;

            const croppedMapCanvas = this.cropAndPadCanvas(mapCanvas, this.settings.crop_left, this.settings.crop_top, cropWidth, cropHeight, this.settings.padding_left, this.settings.padding_top, finalWidth, finalHeight);

            rawImg = croppedMapCanvas.toBuffer("image/png");
            base64Img = croppedMapCanvas.toDataURL();
        }


        return {
            img: rawImg,
            base64: base64Img
        };
    }


    drawEntities(ctx) {
        if (this.settings.drawPath) {
            this.mapData.entities.filter(e => e.type === "path").forEach(
                pathEntity =>{
                    const path = this.translatePixels(this.translateCoordinatesToPixels(pathEntity.points));
                    ctx.beginPath();
                    ctx.strokeStyle = this.colors.path;
                    this.drawLines(ctx, path);
                    ctx.stroke();
                });


            const predictedPathEntity = this.mapData.entities.find(e => e.type === "predicted_path");
            if (predictedPathEntity) {
                const predictedPath = this.translatePixels(this.translateCoordinatesToPixels(predictedPathEntity.points));
                ctx.beginPath();
                ctx.setLineDash([5, 5]);
                this.drawLines(ctx, predictedPath);
                ctx.stroke();
                ctx.setLineDash([]);
            }

        }


        if (this.settings.drawCharger) {
            const chargerLocationEntity = this.mapData.entities.find(e => e.type === "charger_location");
            if (chargerLocationEntity) {
                const chargerLocation = this.translatePixels(this.translateCoordinatesToPixels(chargerLocationEntity.points));
                ctx.drawImage(
                    imgCharger,
                    chargerLocation[0] - (imgCharger.height / this.settings.scale) / 2,
                    chargerLocation[1] - (imgCharger.width / this.settings.scale) / 2,
                    imgCharger.width / this.settings.scale,
                    imgCharger.height / this.settings.scale
                );
            }
        }



        if (this.settings.drawRobot) {
            const robotPositionEntity = this.mapData.entities.find(e => e.type === "robot_position");
            if (robotPositionEntity) {
                const robotPosition = this.translatePixels(this.translateCoordinatesToPixels(robotPositionEntity.points));
                ctx.drawImage(
                    this.rotateImage(imgRobot, robotPositionEntity.metaData.angle),
                    robotPosition[0] - (imgRobot.width / this.settings.scale) / 2,
                    robotPosition[1] - (imgRobot.height / this.settings.scale) / 2,
                    imgRobot.width / this.settings.scale,
                    imgRobot.height / this.settings.scale
                );
            }
        }



        this.mapData.entities.filter(e => e.type === "virtual_wall").forEach(virtualWall => {
            const virtualWallPath = this.translatePixels(this.translateCoordinatesToPixels(virtualWall.points));
            ctx.beginPath();
            ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
            ctx.setLineDash([5, 5]);
            this.drawLines(ctx, virtualWallPath);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        this.mapData.entities.filter(e => e.type === "no_go_area").forEach(noGoZone => {
            const noGoZonePixels = this.translatePixels(this.translateCoordinatesToPixels(noGoZone.points));
            ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
            ctx.fillRect(noGoZonePixels[0], noGoZonePixels[1], noGoZonePixels[2] - noGoZonePixels[0], noGoZonePixels[5] - noGoZonePixels[1]);
        });
    }

    drawLayers(ctx, scaledCanvasWidth, scaledCanvasHeight, voronoiData) {
        const layerImageData = new Canvas.ImageData(
            new Uint8ClampedArray( scaledCanvasWidth * scaledCanvasHeight * 4 ),
            scaledCanvasWidth,
            scaledCanvasHeight
        );

        if (this.mapData.layers && this.mapData.layers.length) {

            this.mapData.layers.forEach(layer => {
                let color = { r: 0, g: 0, b: 0, a: 255 };

                for (let i = 0; i < layer.pixels.length; i += 2) {
                    const x = layer.pixels[i];
                    const y = layer.pixels[i + 1];


                    for (let yi = 0; yi < this.settings.scale; yi++) {
                        const yDelta = (y * this.settings.scale + yi) * scaledCanvasWidth;

                        for (let xi = 0; xi < this.settings.scale; xi++) {
                            const xDelta = x * this.settings.scale + xi;
                            const imgLayersOffset = (xDelta + yDelta) * 4;

                            if (layer.type === "floor" || layer.type === "segment"){
                                layerImageData.data[imgLayersOffset] = voronoiData[imgLayersOffset];
                                layerImageData.data[imgLayersOffset + 1] = voronoiData[imgLayersOffset + 1];
                                layerImageData.data[imgLayersOffset + 2] = voronoiData[imgLayersOffset + 2];
                                layerImageData.data[imgLayersOffset + 3] = voronoiData[imgLayersOffset + 3];
                            } else if (layer.type === "wall") {
                                layerImageData.data[imgLayersOffset] = color.r;
                                layerImageData.data[imgLayersOffset + 1] = color.g;
                                layerImageData.data[imgLayersOffset + 2] = color.b;
                                layerImageData.data[imgLayersOffset + 3] = color.a;
                            }
                        }
                    }
                }
            });
        }

        ctx.putImageData(layerImageData, 0, 0);
    }

    drawLines(ctx, points) {
        let first = true;

        for (let i = 0; i < points.length; i += 2) {
            const [x, y] = ([points[i], points[i + 1]]);
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
    }

    drawPolygon(ctx, points, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        this.drawLines(ctx, points);
        ctx.closePath();
        ctx.fill();
    }


    getColorForSignal(signal) {
        const colorIndex = Math.floor((signal - this.minDb) * 100 / (this.maxDb - this.minDb));
        if (colorIndex < 0){
            return this.mapColors[0];
        } else if (colorIndex >= this.mapColors.length) {
            return this.mapColors[this.mapColors.length-1];
        }
        return this.mapColors[colorIndex];
    }

    /**
     *
     * @param {Array<number>} coords
     * @return {Array<number>}
     */
    translateCoordinatesToPixels(coords) {
        return coords.map(d => Math.round(d / this.mapData.pixelSize));
    }

    /**
     * As most of the time, around 80% of the coordinate space are completely empty, we crop the data that should
     * be rendered to the area where there actually is some map data
     *
     * @param {Array<number>} pixels
     * @return {Array<number>}
     */
    translatePixels(pixels) {
        const arr = [];
        for (let i = 0; i < pixels.length; i += 2) {
            const x = pixels[i];
            const y = pixels[i + 1];

            if (x >= this.bounds.x1 && x <= this.bounds.x2 && y >= this.bounds.y1 && y <= this.bounds.y2) {
                arr.push(x - this.bounds.x1, y - this.bounds.y1);
            }
        }
        return arr;
    }
}

module.exports = MapDrawer;
