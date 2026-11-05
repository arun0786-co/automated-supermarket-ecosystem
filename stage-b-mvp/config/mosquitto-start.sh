#!/bin/sh
# builds the password file from env at start, so no credentials live in the repo or the image
set -eu
PASSWORDS=/mosquitto/passwords
: > "$PASSWORDS"
mosquitto_passwd -b "$PASSWORDS" fleet "$MQTT_FLEET_PASSWORD"
mosquitto_passwd -b "$PASSWORDS" trolley "$MQTT_TROLLEY_PASSWORD"
# mosquitto wants these owned by its own user and private, and will refuse them in future
cp /mosquitto/config/acl.conf /mosquitto/acl
chown mosquitto:mosquitto "$PASSWORDS" /mosquitto/acl
chmod 0700 "$PASSWORDS" /mosquitto/acl
exec mosquitto -c /mosquitto/config/mosquitto.conf
