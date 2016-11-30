"use strict";

var fs = require('fs');
var chokidar = require('chokidar');

var Utils = {
    createBlank: function (path) {
	fs.writeFileSync(path, "{}");
    },
    
    read: function (path) {
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

    loadInclude: function (conf) {
        var doInclude = function(obj) {
            for (var f in obj) {
                var field = obj[f];
                var type = typeof field;
                if (type === 'object') {
                    doInclude(field);
                } else if (typeof field == 'string' && field.startsWith("#include ")) {
                    var path = field.substr(9);
                    obj[f] = Utils.read(path);
                }
            }
        }

        doInclude(conf);
    },

    injectVariable: function (conf) {
        var doInject = function(obj) {
            for (var f in obj) {
                var field = obj[f];
                var type = typeof field;
                if (type === 'object') {
                    doInject(field);
                } else  if (type === 'string' && field.startsWith("#= ")) {
                    var varName = field.substr(3);
                    obj[f] = Utils.byString(conf, varName);
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

    this.load();

    var watcher = chokidar.watch(path, {ignored: /[\/\\]\./, persistent: true});
    watcher
        .on('change', function (path) {
            this.load();
        }.bind(this));
};

Config.prototype.load = function () {
    try {
        var conf = Utils.read(this.path);
        Utils.loadInclude(conf);
        Utils.injectVariable(conf);
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
            return true;
        }
    } catch (e) {
        console.log(`load error: ${this.path}`);
    }
    return false;
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
