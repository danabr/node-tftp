/*
  Simple TFTP server only working in binary mode
*/
var dgram = require('dgram');
var util = require('util');
var os = require('os');
var messageParser = require('./message_parser').messageParser;
var Session = require('./session.js').Session;

var sessions = {};

var handleMsg = function(buffer, addrinfo) {
  var session = getOrCreateSession(addrinfo);
  var msg = messageParser.parse(buffer);
  session.handleMessage(msg);
};

var getOrCreateSession = function(addrinfo) {
  var id = util.format("%s:%d", addrinfo.address, addrinfo.port);
  if(sessions[id] === undefined) {
    sessions[id] = new Session(id, addrinfo, server);
  }
    return sessions[id];
};

// Initial connection handling
var server = dgram.createSocket("udp4", handleMsg);
console.log("Starting TFTP server");
server.bind(69);
console.log("TFTP server available on %s:%d", server.address().address,
                                              server.address().port);
var clearStaleSessions = function() {
  var clearTime = os.uptime() - 30;
  for(sessionId in sessions) {
    if(sessions.hasOwnProperty(sessionId)) {
      if(sessions[sessionId].lastMsgAt < clearTime) {
        console.log("Clearing stale session: %s", sessionId);
        deleteSession(sessions[sessionId]); 
      }
    }
  }
};

var deleteSession = function(session) {
  session.destroy();
  delete sessions[session.id];
};

setInterval(clearStaleSessions, 30000);
