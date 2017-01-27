"use strict";

var fs = require('fs');
var async = require('async');
var chokidar = require('chokidar');
var mpath = require('path');

var Utils = {
    createBlank: function (path) {
	fs.writeFileSync(path, "{}");
    },
    
    readSync: function (path) {
	var data = fs.readFileSync(path),
	    json;
    try {
        json = JSON.parse(data);
    } catch (e) {
        return null;
    }
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

    getIncludeInfo: function(conf, cwd) {
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
                    if (!mpath.isAbsolute(path)) {
                        path = mpath.join(cwd, path);
                    }
                    includes.push({parentPath: parentPath, fieldName: fieldName, file: path});
                }
            }

            return includes;
        }

        return doInclude(conf, ".");
    },

    loadIncludeSync: function (conf, cwd) {
        var includes = Utils.getIncludeInfo(conf, cwd);

        for (var i in includes) {
            var include = includes[i];
            var json = Utils.readSync(include.file);
            if (!json) {
                return `JSON file error: ${include.file}`
            }
            Utils.byString(conf, include.parentPath)[include.fieldName] = json;
        }
    },

    loadIncludeAsync: function (conf, cwd, next) {
        var includes = Utils.getIncludeInfo(conf, cwd);

        async.each(includes, function (include, nextInclude) {
            fs.readFile(include.file, function (err, data) {
                if (err) return nextInclude(err);

                try {
                    var json = JSON.parse(data);
                    Utils.byString(conf, include.parentPath)[include.fieldName] = json;
                } catch (e) {
                    err = `JSON file error: ${include.file}`
                }
                nextInclude(err);
            });
        }, function (err) {
            next(err);
        });
    },

    injectVariable: function (conf) {
        var doInject = function(obj) {
            for (var fieldName in obj) {
                var subObj = obj[fieldName];
                var type = typeof subObj;
                if (type === 'object') {
                    var err = doInject(subObj);
                    if (err) return err;
                } else  if (type === 'string') {
                    if (subObj.startsWith('#= ')) {
                        var varName = subObj.substr(3);
                        var value = Utils.byString(conf, varName);
                        if (value === undefined) {
                            return `JSON file error: ${varName}`;
                        }
                        obj[fieldName] = value;
                    } else if (subObj.startsWith('#+ ')) {
                        var varName = subObj.substr(3).split(' ');
                        obj[fieldName] = undefined;
                        varName.forEach(function (n) {
                            var value = Utils.byString(conf, n);
                            if (value === undefined) {
                                return `JSON file error: ${n}`;
                            }
                            if (obj[fieldName] === undefined) {
                                obj[fieldName] = value;
                            } else {
                                obj[fieldName] += value;
                            }
                        });
                    }
                }
            }
        }

        return doInject(conf);
    },
};

var Config = function (path, checkFn, reload) {
    if (!mpath.isAbsolute(path)) {
        path = mpath.join(process.cwd(), path);
    }

    this.sep = "\.";
    this.path = path;
    this.checkFn = checkFn;

    this.loadSync();

    if (reload) {
        var watcher = chokidar.watch(path, {ignored: /[\/\\]\./, persistent: true});
        watcher
            .on('change', function (path) {
                this.loadAsync();
            }.bind(this));
    }
};

Config.prototype.loadSync = function () {
    try {
        var conf = Utils.readSync(this.path);
        var cwd = mpath.dirname(this.path);
        var err = Utils.loadIncludeSync(conf, cwd);
        if (!err) {
            err = Utils.injectVariable(conf);
        }
        if (err) {
            conf = { error: err};
        }
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
    var cwd = mpath.dirname(path);

    async.series([
        function (callback) {
            fs.readFile(path, function (err, data) {
                if (err) return callback(err);

                try {
                    conf = JSON.parse(data);
                } catch (e) {
                    err = `Parse json error: ${path}`;
                }
                callback(err);
            });
        },
        function (callback) {
            Utils.loadIncludeAsync(conf, cwd, callback);
        },
        function (callback) {
            var err = Utils.injectVariable(conf);
            callback(err);
        }
    ], function (err) {
        if (err) {
            conf = { error: err };
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
