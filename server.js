/*
  Simple TFTP server only working in binary mode
*/

var dgram = require('dgram');
var util = require('util');
var fs = require('fs');
var os = require('os');
var msgs = require('./messages');

var opcodes = {
  read:  1,
  write: 2,
  data:  3,
  ack:   4,
  error: 5,
  invalid: 6
};

var sessions = {};

var extractPath = function(buffer) {
  var length = buffer.length;
  for(var offset = 2; offset < length; offset++) {
    if(buffer[offset] == 0) {
      break;
    }
  }
  var filename = buffer.slice(2, offset);
  return filename.toString("ascii", 0, filename.length);
}

var getOrCreateSession = function(id, addrinfo) {
  if(sessions[id] === undefined) {
    sessions[id] = {id: id, dest: addrinfo, block:1, buffer: []};
  }
    return sessions[id];
};

var sendData = function(dest, block, data) {
  sendMessage(dest, new msgs.Data(block, data));
};

var deleteSession = function(session) {
  if(session.stream !== undefined && 
      (session.stream.readable || session.stream.writable)) {
    session.stream.destroy();
  }
  delete sessions[session.id];
};

var initValidRead = function(session, path) {
  session.state = "data_wait";
  var stream = fs.createReadStream(path, { flags: 'r', bufferSize: 512 });
  stream.on("data", function(data) {
    stream.pause();
    session.buffer.push(data);
    if(session.state === "data_wait") {
      sendUntilAcked(session, session.block, data, 0);
      session.state = "ack_wait";
    }
  });
  stream.on("error", function(error) {
    sendError(session, "Read error");
  });
  stream.on("end", function() {
    session.finished = true;
  });
  session.stream = stream;
};

var sendUntilAcked = function(session, block, data, errors) {
  if(block == session.block) {
    if(errors > 0) {
      console.log("%s: %d attempt to send block %d",
                  session.id, errors+1, block); 
    }
    sendData(session.dest, block, data);
    if(errors < 5) {
      errors += 1;
      // The timeout never seem to trigger.
      setTimeout(sendUntilAcked, errors*1000, session, block, data, errors);
    } else {
      console.log("%s: Block %d was never acked. Stopping transmission.",
                  session.id);
    }
  } // Else, block has been acked
};

var extractBlock = function(buffer) {
  return buffer[2] * 256 + buffer[3];
};

var continueRead = function(session, buffer) {
  var ackedBlock = extractBlock(buffer);
  if(ackedBlock === session.block) {
    session.stream.resume();
    session.buffer.shift(); 
    session.block += 1;
    if(session.buffer.length === 0) {
      if(session.finished === true) {
        console.log("%s: File downloaded successfully!", session.id);
      } else {
        session.state = "data_wait";
      }
    } else {
      sendUntilAcked(session, session.block, session.buffer[0], 0);
    }
  } else {
    // Special case:
    // The file we sent was exactly 512*n bytes.
    // We must send an empty data package.
    if(ackedBlock === session.block-1 && session.finished && 
        session.buffer.length == 0) {
      sendUntilAcked(session, session.block, new Buffer(0), 0);
    } else {
      console.log("Waiting for ack for %d, but got for %d.",
                  session.block, ackedBlock);
    }
  }
};

var initRead = function(session, buffer) {
  var path = extractPath(buffer);
  console.log("%s: GET %s", session.id, path);
  if(session.stream === undefined) {
    fs.stat(path, function(error, stats) {
      if(error) {
        sendError(session.dest, error.toString());
      } else if(!stats.isFile()) {
        sendError(session.dest, path + " is not a file"); 
      } else {
        initValidRead(session, path);
      }
    });
  } else {
    sendError(session.dest, "Unexpected read request");
  }
};

var extractOpCode = function(buffer) {
  if(buffer.length > 2) {
    return buffer[0]*256 + buffer[1];
  } else {
    return opcodes.invalid;
  }
};

var sendError = function(dest, msg) {
  sendMessage(dest, new msgs.Error(0, msg));
}

var sendMessage = function(dest, msg) {
  var buffer = msg.toBuffer();
  tftp.send(buffer, 0, buffer.length, dest.port, dest.address);
}

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

var initWrite = function(session, buffer) {
  var path = extractPath(buffer); 
  console.log("%s: PUT %s", session.id, path);
  var stream = fs.createWriteStream(path, { flags: 'w'});
  stream.on("error", function(error) {
    sendError(session.dest, "Write error!")
  });
  stream.on("drain", function() {
    sendAck(session.dest, session.block);
    session.block += 1;
  });
  session.stream = stream;
  sendAck(session.dest, 0); 
};

var sendAck = function(dest, block) {
  sendMessage(dest, new msgs.Ack(block));
};

var continueWrite = function(session, buffer) {
  var block = extractBlock(buffer);
  if(block == session.block) {
    var data = extractData(buffer);
    session.stream.write(data);
    if(data.length < 512) {
      session.stream.end();
      sendAck(session.dest, session.block);
      console.log("%s: Write finished successfully!", session.id);
    }
  } else if(block > session.block) {
    sendError(session.dest, "Unexpected block number")
  } else if(block < session.block) {
    // Our ack may have been lost
    sendAck(session.dest, block);
  }
};

var extractData = function(buffer) {
  return buffer.slice(4);
};

var handleError = function(session, buffer) {
  var code = extractErrorCode(buffer);
  var msg = extractErrorMessage(buffer);
  console.log("%s: Client reported error! Code: %d, msg: %s",
              session.id, code, msg);
};

var extractErrorCode = function(buffer) {
  return buffer[2] * 256 + buffer[3];
};

var extractErrorMessage = function(buffer) {
  return buffer.slice(4, buffer.length-1).toString("utf-8");
};

var handleMsg = function(buffer, addrinfo) {
  var id = util.format("%s:%d", addrinfo.address, addrinfo.port);
  var session = getOrCreateSession(id, addrinfo);
  session.lastMsgAt = os.uptime();
  var opcode = extractOpCode(buffer);
  if(opcode == opcodes.read) {
    initRead(session, buffer);
  } else if(opcode == opcodes.write) {
    initWrite(session, buffer);
  } else if(opcode == opcodes.data) {
    continueWrite(session, buffer);
  } else if(opcode == opcodes.ack) {
    continueRead(session, buffer);
  } else if(opcode == opcodes.error) {
    handleError(session, buffer);
  } else {
    // Reply with error
    console.log("Invalid opcode: %d", opcode);
    sendError(addrinfo, "Invalid opcode");
  }
};

// Initial connection handling
var tftp = dgram.createSocket("udp4", handleMsg);
console.log("Starting TFTP server");
tftp.bind(69);
console.log("TFTP server available on %s:%d", tftp.address().address,
                                              tftp.address().port);
setInterval(clearStaleSessions, 30000);
