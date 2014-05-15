/*global define*/
define([
        '../../Core/BingMapsApi',
        '../../Core/defaultValue',
        '../../Core/defined',
        '../../Core/defineProperties',
        '../../Core/DeveloperError',
        '../../Core/jsonp',
        '../../Core/Matrix4',
        '../../Core/Rectangle',
        '../../Scene/CameraColumbusViewMode',
        '../../Scene/CameraFlightPath',
        '../../Scene/SceneMode',
        '../../ThirdParty/knockout',
        '../../ThirdParty/when',
        '../createCommand'
    ], function(
        BingMapsApi,
        defaultValue,
        defined,
        defineProperties,
        DeveloperError,
        jsonp,
        Matrix4,
        Rectangle,
        CameraColumbusViewMode,
        CameraFlightPath,
        SceneMode,
        knockout,
        when,
        createCommand) {
    "use strict";

    /**
     * The view model for the {@link Geocoder} widget.
     * @alias GeocoderViewModel
     * @constructor
     *
     * @param {Scene} options.scene The Scene instance to use.
     * @param {String} [options.url='//dev.virtualearth.net'] The base URL of the Bing Maps API.
     * @param {String} [options.key] The Bing Maps key for your application, which can be
     *        created at <a href='https://www.bingmapsportal.com/'>https://www.bingmapsportal.com/</a>.
     *        If this parameter is not provided, {@link BingMapsApi.defaultKey} is used.
     *        If {@link BingMapsApi.defaultKey} is undefined as well, a message is
     *        written to the console reminding you that you must create and supply a Bing Maps
     *        key as soon as possible.  Please do not deploy an application that uses
     *        this widget without creating a separate key for your application.
     * @param {Number} [options.flightDuration=1500] The duration of the camera flight to an entered location, in milliseconds.
     */
    var GeocoderViewModel = function(options) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(options) || !defined(options.scene)) {
            throw new DeveloperError('options.scene is required.');
        }
        //>>includeEnd('debug');

        this._url = defaultValue(options.url, '//dev.virtualearth.net/');
        if (this._url.length > 0 && this._url[this._url.length - 1] !== '/') {
            this._url += '/';
        }

        this._key = BingMapsApi.getKey(options.key);
        this._scene = options.scene;
        this._flightDuration = defaultValue(options.flightDuration, 1500);
        this._searchText = '';
        this._isSearchInProgress = false;
        this._geocodeInProgress = undefined;

        var that = this;
        this._searchCommand = createCommand(function() {
            if (that.isSearchInProgress) {
                cancelGeocode(that);
            } else {
                geocode(that);
            }
        });

        knockout.track(this, ['_searchText', '_isSearchInProgress']);

        /**
         * Gets a value indicating whether a search is currently in progress.  This property is observable.
         *
         * @type {Boolean}
         */
        this.isSearchInProgress = undefined;
        knockout.defineProperty(this, 'isSearchInProgress', {
            get : function() {
                return this._isSearchInProgress;
            }
        });

        /**
         * Gets or sets the text to search for.
         *
         * @type {String}
         */
        this.searchText = undefined;
        knockout.defineProperty(this, 'searchText', {
            get : function() {
                if (this.isSearchInProgress) {
                    return 'Searching...';
                }
                return this._searchText;
            },
            set : function(value) {
                //>>includeStart('debug', pragmas.debug);
                if (typeof value !== 'string') {
                    throw new DeveloperError('value must be a valid string.');
                }
                //>>includeEnd('debug');

                this._searchText = value;
            }
        });

        /**
         * Gets or sets the the duration of the camera flight in milliseconds.
         * A value of zero causes the camera to instantly switch to the geocoding location.
         *
         * @type {Number}
         * @default 1500
         */
        this.flightDuration = undefined;
        knockout.defineProperty(this, 'flightDuration', {
            get : function() {
                return this._flightDuration;
            },
            set : function(value) {
                //>>includeStart('debug', pragmas.debug);
                if (value < 0) {
                    throw new DeveloperError('value must be positive.');
                }
                //>>includeEnd('debug');

                this._flightDuration = value;
            }
        });
    };

    defineProperties(GeocoderViewModel.prototype, {
        /**
         * Gets the Bing maps url.
         * @memberof GeocoderViewModel.prototype
         *
         * @type {String}
         */
        url : {
            get : function() {
                return this._url;
            }
        },

        /**
         * Gets the Bing maps key.
         * @memberof GeocoderViewModel.prototype
         *
         * @type {String}
         */
        key : {
            get : function() {
                return this._key;
            }
        },

        /**
         * Gets the scene to control.
         * @memberof GeocoderViewModel.prototype
         *
         * @type {Scene}
         */
        scene : {
            get : function() {
                return this._scene;
            }
        },

        /**
         * Gets the Command that is executed when the button is clicked.
         * @memberof GeocoderViewModel.prototype
         *
         * @type {Command}
         */
        search : {
            get : function() {
                return this._searchCommand;
            }
        }
    });

    var transform2D = new Matrix4(0.0, 0.0, 1.0, 0.0,
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0);

    function geocode(viewModel) {
        var query = viewModel.searchText;

        if (/^\s*$/.test(query)) {
            //whitespace string
            return;
        }

        viewModel._isSearchInProgress = true;

        var promise = jsonp(viewModel._url + 'REST/v1/Locations', {
            parameters : {
                query : query,
                key : viewModel._key

            },
            callbackParameterName : 'jsonp'
        });

        var geocodeInProgress = viewModel._geocodeInProgress = when(promise, function(result) {
            if (geocodeInProgress.cancel) {
                return;
            }
            viewModel._isSearchInProgress = false;

            if (result.resourceSets.length === 0) {
                viewModel.searchText = viewModel._searchText + ' (not found)';
                return;
            }

            var resourceSet = result.resourceSets[0];
            if (resourceSet.resources.length === 0) {
                viewModel.searchText = viewModel._searchText + ' (not found)';
                return;
            }

            var resource = resourceSet.resources[0];

            viewModel._searchText = resource.name;
            var bbox = resource.bbox;
            var south = bbox[0];
            var west = bbox[1];
            var north = bbox[2];
            var east = bbox[3];
            var rectangle = Rectangle.fromDegrees(west, south, east, north);

            var camera = viewModel._scene.camera;
            var position = camera.getRectangleCameraCoordinates(rectangle);
            if (!defined(position)) {
                // This can happen during a scene mode transition.
                return;
            }

            var options = {
                destination : position,
                duration : viewModel._flightDuration,
                onComplete : function() {
                    var screenSpaceCameraController = viewModel._scene.screenSpaceCameraController;
                    screenSpaceCameraController.globe = viewModel._scene.globe;
                    screenSpaceCameraController.columbusViewMode = CameraColumbusViewMode.FREE;
                },
                endReferenceFrame : (viewModel._scene.mode !== SceneMode.SCENE3D) ? transform2D : Matrix4.IDENTITY
            };

            var flight = CameraFlightPath.createAnimation(viewModel._scene, options);
            viewModel._scene.animations.add(flight);
        }, function() {
            if (geocodeInProgress.cancel) {
                return;
            }

            viewModel._isSearchInProgress = false;
            viewModel.searchText = viewModel._searchText + ' (error)';
        });
    }

    function cancelGeocode(viewModel) {
        viewModel._isSearchInProgress = false;
        if (defined(viewModel._geocodeInProgress)) {
            viewModel._geocodeInProgress.cancel = true;
            viewModel._geocodeInProgress = undefined;
        }
    }

    return GeocoderViewModel;
});
