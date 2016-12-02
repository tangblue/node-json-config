# node-json-config
Read and Write configurations to JSON file.

# How to use

## initialize

Create Config instance with JSON path.
Configurations are automatically loaded from the JSON file.

### Arguments
new Config(path, checkFn, reload);
+ path: The JSON file name.
+ checkFn: The config check function. Invoked with (conf). Return true is the config is valid, else return false.
+ reload: Boolean for reload automatically when the JSON file is changed.

```
var conf = new Config("./config.json", checkFn, false);
```

## Read configuration

You can access configurations using dot notation.

Here is sample JSON.

```
{
  "one": 1,
  "a": {
    "b": {
	  "c": "ABC"
	}
  }
}
```

```
conf.get("one")    // 1
conf.get("a.b.c")  // "ABC"
```

## Write configuration

Also you can put new configuration using dot notation.

```
{
  "one": 1,
  "a": {
    "b": {
	  "c": "ABC"
	}
  }
}
```

```
conf.put("two", 2);
conf.put("x.y.z", "XYZ");
```

```
{
  "one": 1,
  "a": {
    "b": {
	  "c": "ABC"
	}
  },
  "two": 2,
  "x": {
    "y": {
	  "z": "XYZ"
	}
  }
}
```

## Save configurations

```
conf.save();
```

## JSON extenstion

### Include another JSON file
If the value is string and start with "#include ", the value will be replaced by the value loaded from the included JSON file. The included JSON file name is the string after "#include ".

Note: Only support one level include file. The include files in an include file will not be loaded.

Example:
```
{
    "constants": "#include ./constants.json",
}
```

### Reference value
If the value is string and start with "#= ", the value will be replaced by the referenced value. The referenced value name is the string after "#include ".

Note: Only support absolutely reference.

Example:
```
{
    "constants": "#include ./constants.json",

    "message": "#= constants.message",
}
```

## Reload automatically when the JSON file is changed
When the third argument "reload" is true, the config will be reload automatically when the JSON file is changed.
