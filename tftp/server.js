/*
  Simple TFTP server only working in binary mode
*/
var dgram = require('dgram');
var util = require('util');
var os = require('os');
var messageParser = require('./message_parser').messageParser;
var Session = require('./session.js').Session;

function Server(port) {
  var self = this;
  var sessions = {};
  this.port = port || 69;

  var handleMsg = function(buffer, peer) {
    var session = getOrCreateSession(peer);
    var msg = messageParser.parse(buffer);
    session.handleMessage(msg);
  };

  var getOrCreateSession = function(peer) {
    var id = util.format("%s:%d", peer.address, peer.port);
    if(sessions[id] === undefined) {
      sessions[id] = new Session(id, self.socket, peer);
    }
      return sessions[id];
  };

  this.clearStaleSessions = function() {
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

  this.socket = dgram.createSocket("udp4", handleMsg);
}

Server.prototype.listen = function() {
  this.socket.bind(this.port);
  setInterval(this.clearStaleSessions, 30000);
};

Server.prototype.address = function() {
  return this.socket.address();
};

exports.Server = Server;
