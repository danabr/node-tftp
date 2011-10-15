var messages = require('./messages');

function TFTPSocket(socket, destination) {
  this.sendMessage = function(msg) {
    var buffer = msg.toBuffer();
    socket.send(buffer, 0, buffer.length, 
      destination.port, destination.address);
  };
}

TFTPSocket.prototype.sendAck = function(block) {
    this.sendMessage(new messages.Ack(block));
};

TFTPSocket.prototype.sendData = function(block, data) {
  this.sendMessage(new messages.Data(block, data));
};

TFTPSocket.prototype.sendError = function(code, msg) {
  this.sendMessage(new messages.Error(code, msg));
};

exports.TFTPSocket = TFTPSocket;
