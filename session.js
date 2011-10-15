var os = require('os');
var msgs = require('./messages');
var opcodes = msgs.opcodes;
var fs = require('fs');

var errors = {
  undefined: 0,
  notFound: 1,
  accessViolation: 2,
  diskFull: 3,
  illegalTFTPOperation: 4,
  unknownTransferID: 5,
  fileExists: 6,
  noSuchUser: 7
};

function Session(id, destination, socket) {
  var self = this;
  this.id = id;
  this.destination = destination;
  this.socket = socket;
  this.block = 1;
  this.buffer = [];
  this.lastMsgAt = -1;
  this.state = "";
  this.stream = undefined;

  this.initRead = function(msg) {
    console.log("%s: GET %s", self.id, msg.file);
    if(self.stream === undefined) {
      fs.stat(msg.file, function(error, stats) {
        if(error) {
          sendError(errors.notFound, error.toString());
        } else if(!stats.isFile()) {
          sendError(errors.notFound, msg.file + " is not a file"); 
        } else {
          initValidRead(msg.file);
        }
      });
    } else {
      sendError(errors.illegalTFTPOperation, "Unexpected read request");
    }
  };

  var initValidRead = function(path) {
    self.state = "data_wait";
    var stream = fs.createReadStream(path, { flags: 'r', bufferSize: 512 });
    stream.on("data", function(data) {
      stream.pause();
      self.buffer.push(data);
      if(self.state === "data_wait") {
        sendUntilAcked(self.block, data, 0);
        self.state = "ack_wait";
      }
    });
    stream.on("error", function(error) {
      sendError(errors.undefined, "Read error");
    });
    stream.on("end", function() {
      self.finished = true;
    });
    self.stream = stream;
  };

  var sendUntilAcked = function(block, data, errors) {
    if(block == self.block) {
      if(errors > 0) {
        console.log("%s: %d attempt to send block %d",
                    self.id, errors+1, block); 
      }
      sendData(block, data);
      if(errors < 5) {
        errors += 1;
        setTimeout(sendUntilAcked, errors*1000, block, data, errors);
      } else {
        console.log("%s: Block %d was never acked. Stopping transmission.",
                    self.id);
      }
    } // Else, block has been acked
  };

  var sendData = function(block, data) {
    sendMessage(new msgs.Data(block, data));
  };

  this.continueRead = function(msg) {
    if(msg.block === self.block) {
      self.stream.resume();
      self.buffer.shift(); 
      self.block += 1;
      if(self.buffer.length === 0) {
        if(self.finished === true) {
          console.log("%s: File downloaded successfully!", self.id);
        } else {
          self.state = "data_wait";
        }
      } else {
        sendUntilAcked(self.block, self.buffer[0], 0);
      }
    } else {
      // Special case:
      // The file we sent was exactly 512*n bytes.
      // We must send an empty data package.
      if(msg.block === self.block-1 && self.finished && 
          self.buffer.length == 0) {
        sendUntilAcked(self.block, new Buffer(0), 0);
      } else {
        console.log("Waiting for ack for %d, but got for %d.",
                    self.block, ackedBlock);
      }
    }
  };

  this.initWrite = function(msg) {
    console.log("%s: PUT %s", self.id, msg.file);
    var stream = fs.createWriteStream(msg.file, { flags: 'w'});
    stream.on("error", function(error) {
      sendError(errors.undefined, "Write error!")
    });
    stream.on("drain", function() {
      sendAck(self.block);
      self.block += 1;
    });
    self.stream = stream;
    sendAck(0); 
  };

  var sendError = function(code, msg) {
    sendMessage(new msgs.Error(code, msg));
  };

  var sendMessage = function(msg) {
    var buffer = msg.toBuffer();
    socket.send(buffer, 0, buffer.length, 
      destination.port, destination.address);
  };

  var sendAck = function(block) {
    sendMessage(new msgs.Ack(block));
  };

  this.continueWrite = function(msg) {
    if(msg.block == self.block) {
      self.stream.write(msg.data);
      if(msg.data.length < 512) {
        self.stream.end();
        sendAck(self.block);
        console.log("%s: Write finished successfully!", self.id);
      }
    } else if(block > self.block) {
      sendError(errors.undefined, "Unexpected block number")
    } else if(block < self.block) {
      sendAck(block); // Our ack may have been lost
    }
  };

  this.handleError = function(msg) {
    console.log("%s: Client reported error! Code: %d, msg: %s",
                self.id, msg.code, msg.message);
  };

}

Session.prototype.handleMessage = function(msg) {
  this.lastMsgAt = os.uptime();
  switch(msg.opcode) {
    case opcodes.read:
      this.initRead(msg);
      break;
    case opcodes.write:
      this.initWrite(msg);
      break;
    case opcodes.data:
      this.continueWrite(msg);
      break;
    case opcodes.ack:
      this.continueRead(msg);
      break;
    case opcodes.error:
      this.handleError(ession, msg);
      break;
    default:
      console.log("%s: Invalid opcode: %d", this.id, msg.opcode);
      break;
  }
};

Session.prototype.destroy = function() {
  if(this.stream !== undefined && 
      (this.stream.readable || this.stream.writable)) {
    this.stream.destroy();
  }
}

exports.Session = Session;
