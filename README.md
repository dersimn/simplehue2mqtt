This is a very simple approach to build a MQTT <-> Philips Hue Bridge adapter script.  
This script does implement only the most basic functions to keep the code simple and less vulnerable to bugs and errors. Therefore there's no auto-discovery: Your Hue Bridge musst have a static IP. There's also no auto function for registering a new user to the bridge (the usual "now press the link-button" workflow when connecting with a new client). Just a simple timed-poll for the original REST API and value conversion for convinience.

## Usage

### Step 1
Generate a username for this app, press the Link-button on the Hue bridge and run a curl request..  
with Docker:

    docker run --rm dersimn/netutils curl -X "POST" "http://10.1.1.52/api" -d $'{"devicetype": "simplehue2mqtt"}'
  
or natively:

    curl -X "POST" "http://10.1.1.52/api" -d $'{"devicetype": "simplehue2mqtt"}'

### Step 2
Start the script with the newly generated username:

    docker run -d dersimn/simplehue2mqtt --mqtt-url mqtt://10.1.1.50 --bridge-address 10.1.1.52 --bridge-username espOog21cLQWT6bi

### Controll via MQTT

The script will provide the following topic structure:

    hue/maintenance/_bridge    /online    -> true/false
    hue/maintenance/<device_id>/online    -> true/false

    hue/status/<device_id>                -> JSON {"val": true/false/0.0-1.0, "hue": ..., "sat": ...}
    hue/set   /<device_id>                <- JSON,Number,true/false

Values are converted to a range between `0 .. 1.0` for convenience. A value of `0` will turn off the according light. This is different to the native Hue API where a brightness value of `0` would still keep the light on.