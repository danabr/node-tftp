/*
  Simple TFTP server only working in binary mode
*/

var dgram = require('dgram');
var util = require('util');
var fs = require('fs');
var os = require('os');

var opcodes = {
  read:  1,
  write: 2,
  data:  3,
  ack:   4,
  error: 5,
  invalid: 6
};

var sessions = {};

var extractFilename = function(buffer) {
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
  if(data !== undefined) {
    var out = new Buffer(data.length + 4);
    out[0] = 0; out[1] = opcodes.data; // OpCode
    out[2] = (block >> 8) & 0xff;
    out[3] = block & 0xff; 
    data.copy(out, 4, 0, data.length);
    tftp.send(out, 0, out.length, dest.port, dest.address);
  } else {
    console.log("sendData called with no data!");
  }
};

var deleteSession = function(session) {
    if(session.stream !== undefined && session.stream.readable) {
      session.stream.destroy();
    }
    delete sessions[session.id];
};

var initValidRead = function(session, path) {
  session.state = "data_wait";
  var stream = fs.createReadStream(path, { flags: 'r', bufferSize: 512 });
  stream.on("data", function(data) {
    session.buffer.push(data);
    if(session.state === "data_wait") {
      sendData(session.dest, session.block, data);
      session.staten = "ack_wait";
    }
  });
  stream.on("error", function(error) {
    deleteSession(session);
    sendError(session, "Read error");
  });
  stream.on("end", function() {
    session.finished = true;
  });
  session.stream = stream;
};

var extractAckedBlock = function(buffer) {
  return buffer[2] * 256 + buffer[3];
};

var continueRead = function(session, buffer) {
  var ackedBlock = extractAckedBlock(buffer);
  if(ackedBlock === session.block) {
    session.buffer.shift(); 
    session.block += 1;
    if(session.buffer.length === 0) {
      if(session.finished === true) {
        deleteSession(session);
        console.log("Session %s finished successfully", session.id);
      } else {
        session.state = "data_wait";
      }
    } else {
      sendData(session.dest, session.block, session.buffer[0]);
    }
  } else {
    console.log("Waiting for ack for %d, but got for %d.",
                session.block, ackedBlock);
  }
};

var initRead = function(session, buffer) {
  var path = extractFilename(buffer);
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
    deleteSession(session); 
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
  var buffer = new Buffer(msg.length + 5);
  buffer[0] = 0; buffer[1] = opcodes.error; // OpCode
  buffer[2] = 0; buffer[3] = 0; // Error code
  buffer.write(msg, 4, msg.length);
  buffer[msg.length] = 0;
  tftp.send(buffer, 0, buffer.length, dest.port, dest.address); 
}

var clearStaleSessions = function() {
  var clearTime = os.uptime() - 5;
  for(sessionId in sessions) {
    if(sessions.hasOwnProperty(sessionId)) {
      if(sessions[sessionId].lastMsgAt < clearTime) {
        console.log("Clearing stale session: %s", sessionId);
        deleteSession(sessions[sessionId]); 
      }
    }
  }
};

var handleMsg = function(buffer, addrinfo) {
  var id = util.format("%s:%d", addrinfo.address, addrinfo.port);
  var session = getOrCreateSession(id, addrinfo);
  session.lastMsgAt = os.uptime();
  var opcode = extractOpCode(buffer);
  console.log("Msg from %s with opcode %d", id, opcode);
  if(opcode == opcodes.read) {
    initRead(session, buffer);
  } else if(opcode == opcodes.write) {
    initWrite(session, buffer);
  } else if(opcode == opcodes.data) {
    continueWrite(session, buffer);
  } else if(opcode == opcodes.ack) {
    continueRead(session, buffer);
  } else if(opcode == opcodes.error) {
    handlError(session, buffer);
  } else {
    // Reply with error
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
