var os = require('os');
var fs = require('fs');
var opcodes = require('./messages').opcodes;
var TFTPSocket = require('./tftp_socket').TFTPSocket;

var errors = {
  undefined: 0,
  notFound: 1,
  accessViolation: 2,
  diskFull: 3,
  illegalOperation: 4,
  unknownTransferID: 5,
  fileExists: 6,
  noSuchUser: 7
};

function Session(id, socket, destination) {
  var self = this;
  this.id = id;
  this.socket = new TFTPSocket(socket, destination);
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
          self.socket.sendError(errors.notFound, error.toString());
        } else if(!stats.isFile()) {
          self.socket.sendError(errors.notFound, msg.file + " is not a file"); 
        } else {
          initValidRead(msg.file);
        }
      });
    } else {
      self.socket.sendError(errors.illegalOperation, "Unexpected read request");
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
      self.socket.sendError(errors.undefined, "Read error");
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
      self.socket.sendData(block, data);
      if(errors < 5) {
        errors += 1;
        setTimeout(sendUntilAcked, errors*1000, block, data, errors);
      } else {
        console.log("%s: Block %d was never acked. Stopping transmission.",
                    self.id);
      }
    } // Else, block has been acked
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
      self.socket.sendError(errors.undefined, "Write error!")
    });
    stream.on("drain", function() {
      self.socket.sendAck(self.block);
      self.block += 1;
    });
    self.stream = stream;
    self.socket.sendAck(0); 
  };

  this.continueWrite = function(msg) {
    if(msg.block == self.block) {
      if (self.stream.write(msg.data)) {
        self.socket.sendAck(self.block);
        self.block += 1;
      }
      if(msg.data.length < 512) {
        self.stream.end();
        console.log("%s: Write finished successfully!", self.id);
      }
    } else if(block > self.block) {
      self.socket.sendError(errors.undefined, "Unexpected block number")
    } else if(block < self.block) {
      self.socket.sendAck(block); // Our ack may have been lost
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
