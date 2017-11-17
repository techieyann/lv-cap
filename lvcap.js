var mqtt = require('mqtt');


var enums = require('./message_enums.js');

var client;

var containerState = enums.status.INITIAL;
var containerErrorMessage;
var debug;
var id = '';


var startMQTTClient = function (options, processConfig, shutdownCB) {
  id = options.containerId;
  debug = options.debug || false;

  lvcapDebug('connecting to mqtt broker');

  client = mqtt.connect([{ host: 'localhost', port: 1883 }], options.mqtt);

  client.on('connect', function () {
    lvcapDebug('connected');
    lvcap.subscribe('status/request');
    lvcap.subscribe('config/response/'+id, function (){
      lvcap.publish('config/request/'+id, '');
    });
    lvcap.subscribe('command/'+id);
  });

  client.on('message', function (topic, buffer) {
    var message;
    if (buffer.toString()) {
      try {
        message = JSON.parse(buffer.toString());
      }
      catch (e) {
        setStatus('MSG_ERR', 'Invalid JSON');
        publishError('INVALID_JSON', e);
      }
    }

    lvcapDebug(['------------------',
                'message from -- ' + topic,
                message ? buffer.toString():null,
                '------------------'
              ]);

    switch (topic) {
    case 'status/request':
      publishStatus();
      break;
    case 'config/response/' + id:
      var config = parseConfig(message);
      if (config) {
        setStatus('MSG_OK');
        lvcap.config = config;
        if (processConfig) processConfig();
      }
      else {
        setStatus('MSG_ERR', 'Bad config file');
      }
      break;
      case 'command/' + id:
        var commandEnum = message.Command;
        switch (enums.command[commandEnum]) {
          case 'SHUT_DOWN':
          if (shutdownCB) shutdownCB();
          lvcap.shutdown();
        }
        break;
    default:
      lvcap.messages.push({
        topic: topic,
        message: message,
        timestamp: (new Date()).getTime()
      });
    }
  });

  client.on('error', function (error) {
    lvcapDebug('error: '+error);
    if (client.connected) {
      publishError('MQTT_CABLLBACK', error);
    }
  });
};

var stopMQTTClient = function () {
  lvcap.unsubscribe('status/request', function () {
    lvcap.unsubscribe('config/response/'+id, function () {
      lvcap.unsubscribe('command/'+id, function () {
        setStatus('SHUT_DWN', undefined, function () {
          client.end();
        });
      });
    });
  });
};

var parseConfig = function (json) {
  if (json) return json.Configuration;
};

var publishStatus = function (callback) {
  var statusTopic = 'status/response/' + id;

  var status = {
    Status: containerState,
    Message: containerErrorMessage,
    Timestamp: Math.round((new Date()).getTime() / 1000)
  };

  lvcap.publish(statusTopic, JSON.stringify(status), undefined, callback);
};

var setStatus = function (state, message, callback) {
  containerState = enums.status[state];
  containerErrorMessage = message;
  publishStatus(callback);
};

var publishError = function (errorName, message, callback) {
  var errorTopic = 'storage/data/error/' + id;

  var error = {
      Errno: enums.error[errorName],
      Message: message,
      Timestamp: Math.round((new Date()).getTime() / 1000)
  };

  lvcap.publish(errorTopic, JSON.stringify(error), undefined, callback);
};

var pubWrapper = function (topic, message, options, callback) {
  if (client.connected) {
    client.publish(topic, message, options, function (err) {
      if (err) {
        lvcapDebug(['++++++++++++++++++',
                    'publish error: ' + err,
                    '++++++++++++++++++'
                  ]);
        if (topic === 'storage/data/error/' + id) {
          process.stdout.write(err);
        }
        else {
          publishError('MQTT_PUBLISH', err);
        }
      }

      else if (callback) callback();
    });
  }
};

var subWrapper = function (topic, callback) {
  client.subscribe(topic, function (err, granted){
    lvcapDebug(['=================',
                'subscribing to -- ' + topic,
                err ? err : 'success!',
                '================='
              ]);
    if (err) {
      publishError('MQTT_SUBSCRIPTION', err);
    }
    else if (callback) callback();
  });
};

var unsubWrapper = function (topic, callback) {
  client.unsubscribe(topic, function (err) {
    lvcapDebug(['=/=/=/=/=/=/=/=/=',
                'unsubscribing from -- ' + topic,
                err ? err : 'success!',
                '=/=/=/=/=/=/=/=/='
              ]);
    if (err) publishError('MQTT_SUBSCRIPTION', err);
    else if (callback) callback();
  });
};

var lvcapDebug = function (debugMsg) {
  if (debug) {
    if (Array.isArray(debugMsg)) {
      debugMsg.forEach(function (msg) {
        if (typeof msg === 'string')
          console.log(msg);
      });
    }
    else console.log(debugMsg);
  }
};

var lvcap = {
  startup: startMQTTClient,
  shutdown: stopMQTTClient,
  setStatus: setStatus,
  publish: pubWrapper,
  pubError: publishError,
  subscribe: subWrapper,
  unsubscribe: unsubWrapper,
  config: {},
  messages: []
};

module.exports = lvcap;