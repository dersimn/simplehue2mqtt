## Usage

Start with:

    docker run -d dersimn/simplehue2mqtt --mqtt-url mqtt://10.1.1.50 --bridge-address 10.1.1.52 --bridge-username espOog21cLQWT6bi

To generate a username for this app, press the Link-button on the Hue bridge and run a curl request (with Docker or natively):

    docker run --rm dersimn/netutils curl -X "POST" "http://10.1.1.52/api" -d $'{"devicetype": "simplehue2mqtt"}'