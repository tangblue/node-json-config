"use strict";

const async = require('async');
const chokidar = require('chokidar');
const deepcopy = require('deepcopy');
const fs = require('fs');
const mpath = require('path');

const Utils = {
    createBlank: function (path) {
	fs.writeFileSync(path, "{}");
    },
    
    readSync: function (path) {
	let data = fs.readFileSync(path),
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
	let data = Utils.stringify(conf);
	fs.writeFileSync(path, data);
    },

    byString: function(o, s) {
        s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
        s = s.replace(/^\./, '');           // strip a leading dot
        if (s.length < 1) {
            return o;
        }
        let a = s.split('.');
        for (let i = 0, n = a.length; i < n; ++i) {
            let k = a[i];
            if (k in o) {
                o = o[k];
            } else {
                return;
            }
        }
        return o;
    },

    getIncludeInfo: function(conf, cwd) {
        let doInclude = function(obj, parentPath) {
            let includes = [];
            for (let fieldName in obj) {
                let subObj = obj[fieldName];
                let type = typeof subObj;
                if (type === 'object') {
                    let nestIncludes = doInclude(subObj, parentPath + fieldName);
                    for (let ni in nestIncludes) {
                        includes.push(nestIncludes[ni]);
                    }
                } else if (typeof subObj == 'string' && subObj.startsWith("#include ")) {
                    let path = subObj.substr(9);
                    if (!mpath.isAbsolute(path)) {
                        path = mpath.join(cwd, path);
                    }
                    includes.push({parentPath: parentPath, fieldName: fieldName, file: path});
                }
            }

            return includes;
        };

        return doInclude(conf, ".");
    },

    loadIncludeSync: function (conf, cwd) {
        let includes = Utils.getIncludeInfo(conf, cwd);

        for (let i in includes) {
            let include = includes[i];
            let json = Utils.readSync(include.file);
            if (!json) {
                return `JSON file error: ${include.file}`;
            }
            Utils.byString(conf, include.parentPath)[include.fieldName] = json;
        }
    },

    loadIncludeAsync: function (conf, cwd, next) {
        let includes = Utils.getIncludeInfo(conf, cwd);

        async.each(includes, function (include, nextInclude) {
            fs.readFile(include.file, function (err, data) {
                if (err) return nextInclude(err);

                try {
                    let json = JSON.parse(data);
                    Utils.byString(conf, include.parentPath)[include.fieldName] = json;
                } catch (e) {
                    err = `JSON file error: ${include.file}`;
                }
                nextInclude(err);
            });
        }, function (err) {
            next(err);
        });
    },

    injectVariable: function (conf) {
        let getVar = function(root, cur, name) {
            let value;

            if (name.startsWith('/')) {
                value = Utils.byString(global, name.substr(1));
            } else if (name.startsWith('./')) {
                value = Utils.byString(cur, name.substr(2));
            } else if (name) {
                value = Utils.byString(root, name);
            }

            return deepcopy(value);
        }

        let doInject = function(obj) {
            let ret;
            for (let fieldName in obj) {
                let subObj = obj[fieldName];
                let type = typeof subObj;
                if (type === 'object') {
                    let err = doInject(subObj);
                    if (err === 'retry') {
                        ret = 'retry';
                    } else if (err) return err;
                } else  if (type === 'string') {
                    if (subObj.startsWith('#= ')) {
                        let varName = subObj.substr(3);
                        let value = getVar(conf, obj, varName);
                        if (value === undefined) {
                            return `JSON file error: ${varName}`;
                        }
                        obj[fieldName] = value;
                        ret = 'retry';
                    } else if (subObj.startsWith('#+ ')) {
                        let varName = subObj.substr(3).split(' ');
                        obj[fieldName] = undefined;
                        for (let n of varName) {
                            if (!n) continue;
                            let value = getVar(conf, obj, n);
                            if (value === undefined) {
                                return `JSON file error: ${n}`;
                            }
                            if (obj[fieldName] === undefined) {
                                obj[fieldName] = value;
                            } else {
                                obj[fieldName] += value;
                            }
                        }
                        ret = 'retry';
                    }
                }
            }
            return ret;
        };

        let maxInjectLoop = 5;
        for (let i = 0; i < maxInjectLoop; i++) {
            let err = doInject(conf);
            if (!err) return;
            if (err !== "retry") return err;
        }
        return `JSON file error: deadloop`;
    },
};

const Config = function (path, checkFn, reload) {
    if (!mpath.isAbsolute(path)) {
        path = mpath.join(process.cwd(), path);
    }

    this.sep = "\.";
    this.path = path;
    this.checkFn = checkFn;

    this.loadSync();

    if (reload) {
        let watcher = chokidar.watch(path, {ignored: /[\/\\]\./, persistent: true});
        watcher
            .on('change', function (path) {
                this.loadAsync();
            }.bind(this));
    }
};

Config.prototype.loadSync = function () {
    try {
        let conf = Utils.readSync(this.path);
        let cwd = mpath.dirname(this.path);
        let err = Utils.loadIncludeSync(conf, cwd);
        if (!err) {
            err = Utils.injectVariable(conf);
        }
        if (err) {
            conf = { error: err};
        }
        if (this.checkFn && !this.checkFn(conf)) {
            return false;
        }

        let validDate = new Date(conf.validAfter);
        let now = new Date();
        let diff = validDate.getTime() - now.getTime();
        if (isNaN(validDate.getTime()) || diff <= 0) {
            this.conf = conf;
        } else {
            if (this.timer) {
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
};

Config.prototype.loadAsync = function () {
    let conf;
    let path = this.path;
    let cwd = mpath.dirname(path);

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
            let err = Utils.injectVariable(conf);
            callback(err);
        }
    ], function (err) {
        if (err) {
            conf = { error: err };
        }

        if (this.checkFn && this.checkFn(conf)) {
            let validDate = new Date(conf.validAfter);
            let now = new Date();
            let diff = validDate.getTime() - now.getTime();
            if (isNaN(validDate.getTime()) || diff <= 0) {
                this.conf = conf;
            } else {
                if (this.timer) {
                    clearTimeout(this.timer);
                }
                this.timer = setTimeout(function () {
                    this.timer = null;
                    this.conf = conf;
                }, diff);
            }
        }
    }.bind(this));
};

Config.prototype.get = function (key) {
    return Utils.byString(this.conf, key);
};

Config.prototype.put = function (key, value) {
    let elements = key.split(this.sep),
	json = this.conf,
	last;
    if (!elements) {
	return false;
    }
    last = elements.pop();
    elements.forEach(function (element) {
	let obj = json[element];
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
    let elements = key.split(this.sep),
	json = this.conf,
        last;
    if (!elements) {
	return false;
    }
    last = elements.pop();
    elements.forEach(function (element) {
	let obj = json[element];
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
