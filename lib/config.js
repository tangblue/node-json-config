"use strict";

var fs = require('fs');
var async = require('async');
var chokidar = require('chokidar');

var Utils = {
    createBlank: function (path) {
	fs.writeFileSync(path, "{}");
    },
    
    readSync: function (path) {
	var data = fs.readFileSync(path),
	    json;
	json = JSON.parse(data);
	return json;
    },

    stringify: function (json) {
	return JSON.stringify(json, null, "    ");
    },
    
    write: function (conf, path) {
	var data = Utils.stringify(conf);
	fs.writeFileSync(path, data);
    },

    byString: function(o, s) {
        s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
        s = s.replace(/^\./, '');           // strip a leading dot
        if (s.length < 1) {
            return o;
        }
        var a = s.split('.');
        for (var i = 0, n = a.length; i < n; ++i) {
            var k = a[i];
            if (k in o) {
                o = o[k];
            } else {
                return;
            }
        }
        return o;
    },

    getIncludeInfo: function(conf) {
        var doInclude = function(obj, parentPath) {
            var includes = [];
            for (var fieldName in obj) {
                var subObj = obj[fieldName];
                var type = typeof subObj;
                if (type === 'object') {
                    var nestIncludes = doInclude(subObj, parentPath + fieldName);
                    for (var ni in nestIncludes) {
                        includes.push(nestIncludes[ni]);
                    }
                } else if (typeof subObj == 'string' && subObj.startsWith("#include ")) {
                    var path = subObj.substr(9);
                    includes.push({parentPath: parentPath, fieldName: fieldName, file: path});
                }
            }

            return includes;
        }

        return doInclude(conf, ".");
    },

    loadIncludeSync: function (conf) {
        var includes = Utils.getIncludeInfo(conf);

        for (var i in includes) {
            var include = includes[i];
            Utils.byString(conf, include.parentPath)[include.fieldName] = Utils.readSync(include.file);
        }
    },

    loadIncludeAsync: function (conf, callback) {
        var includes = Utils.getIncludeInfo(conf);

        async.each(includes, function (include, callback) {
            fs.readFile(include.file, function (err, data) {
                if (err) return callback(err);

                Utils.byString(conf, include.parentPath)[include.fieldName] = JSON.parse(data);
                callback();
            });
        }, function (err) {
            if (err) return callback(err);
            callback()
        });
    },

    injectVariable: function (conf) {
        var doInject = function(obj) {
            for (var fieldName in obj) {
                var subObj = obj[fieldName];
                var type = typeof subObj;
                if (type === 'object') {
                    doInject(subObj);
                } else  if (type === 'string' && subObj.startsWith("#= ")) {
                    var varName = subObj.substr(3);
                    obj[fieldName] = Utils.byString(conf, varName);
                }
            }
        }

        doInject(conf);
    },
};

var Config = function (path, checkFn) {
    this.sep = "\.";
    this.path = path;
    this.checkFn = checkFn;

    this.loadSync();

    var watcher = chokidar.watch(path, {ignored: /[\/\\]\./, persistent: true});
    watcher
        .on('change', function (path) {
            this.loadAsync();
        }.bind(this));
};

Config.prototype.loadSync = function () {
    try {
        var conf = Utils.readSync(this.path);
        Utils.loadIncludeSync(conf);
        Utils.injectVariable(conf);
        if (!this.checkFn(conf)) {
            return false;
        }

        var validDate = new Date(conf["validAfter"]);
        var now = new Date();
        var diff = validDate.getTime() - now.getTime();
        if (isNaN(validDate.getTime()) || diff <= 0) {
            this.conf = conf;
        } else {
            if (this.timer != null) {
                clearTimeout(this.timer);
            }
            this.timer = setTimeout(function () {
                this.timer = null;
                this.conf = conf;
            }, diff);
        }
        return true;
    } catch (e) {
        console.log(`load error: ${this.path}`);
        console.log(e);
    }
    return false;
}

Config.prototype.loadAsync = function () {
    var conf;
    var path = this.path;

    async.series([
        function (callback) {
            fs.readFile(path, function (err, data) {
                if (err) return callback(err);

                conf = JSON.parse(data);
                callback();
            });
        },
        function (callback) {
            Utils.loadIncludeAsync(conf, callback);
        },
        function (callback) {
            Utils.injectVariable(conf);
            callback();
        }
    ], function (err) {
        if (err) {
            console.log("error in loadAsync");
            return err;
        }

        if (this.checkFn(conf)) {
            var validDate = new Date(conf["validAfter"]);
            var now = new Date();
            var diff = validDate.getTime() - now.getTime();
            if (isNaN(validDate.getTime()) || diff <= 0) {
                this.conf = conf;
            } else {
                if (this.timer != null) {
                    clearTimeout(this.timer);
                }
                this.timer = setTimeout(function () {
                    this.timer = null;
                    this.conf = conf;
                }, diff);
            }
        }
    }.bind(this));
}

Config.prototype.get = function (key) {
    return Utils.byString(this.conf, key);
};

Config.prototype.put = function (key, value) {
    var elements = key.split(this.sep),
	json = this.conf,
	last;
    if (!elements) {
	return false;
    }
    last = elements.pop();
    elements.forEach(function (element) {
	var obj = json[element];
	if (!obj) {
	    obj = {};
	    json[element] = obj;
	}
	json = json[element];
    });
    json[last] = value;
    return true;
};

Config.prototype.remove = function (key) {
    var elements = key.split(this.sep),
	json = this.conf,
        last;
    if (!elements) {
	return false;
    }
    last = elements.pop();
    elements.forEach(function (element) {
	var obj = json[element];
	if (!obj) {
	    obj = {};
	    json[element] = obj;
	}
	json = json[element];
    });
    delete json[last];
    return true;
};

Config.prototype.save = function () {
    Utils.write(this.conf, this.path);
};

Config.prototype.toString = function () {
    return Utils.stringify(this.conf);
};

module.exports = Config;
