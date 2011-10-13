/*
  Simple TFTP server only working in binary mode
*/

var dgram = require('dgram');
var util = require('util');
var fs = require('fs');
var os = require('os');
var messageParser = require('./message_parser').messageParser;
var msgs = require('./messages');

var opcodes = msgs.opcodes;
var sessions = {};

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

var continueRead = function(session, msg) {
  if(msg.block === session.block) {
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
    if(msg.block === session.block-1 && session.finished && 
        session.buffer.length == 0) {
      sendUntilAcked(session, session.block, new Buffer(0), 0);
    } else {
      console.log("Waiting for ack for %d, but got for %d.",
                  session.block, ackedBlock);
    }
  }
};

var initRead = function(session, msg) {
  console.log("%s: GET %s", session.id, msg.file);
  if(session.stream === undefined) {
    fs.stat(msg.file, function(error, stats) {
      if(error) {
        sendError(session.dest, error.toString());
      } else if(!stats.isFile()) {
        sendError(session.dest, msg.file + " is not a file"); 
      } else {
        initValidRead(session, msg.file);
      }
    });
  } else {
    sendError(session.dest, "Unexpected read request");
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

var initWrite = function(session, msg) {
  console.log("%s: PUT %s", session.id, msg.file);
  var stream = fs.createWriteStream(msg.file, { flags: 'w'});
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

var continueWrite = function(session, msg) {
  if(msg.block == session.block) {
    session.stream.write(msg.data);
    if(msg.data.length < 512) {
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

var handleError = function(session, msg) {
  console.log("%s: Client reported error! Code: %d, msg: %s",
              session.id, msg.code, msg.message);
};

var handleMsg = function(buffer, addrinfo) {
  var id = util.format("%s:%d", addrinfo.address, addrinfo.port);
  var session = getOrCreateSession(id, addrinfo);
  session.lastMsgAt = os.uptime();
  var msg = messageParser.parse(buffer);
  switch(msg.opcode) {
    case opcodes.read:
      initRead(session, msg);
      break;
    case opcodes.write:
      initWrite(session, msg);
      break;
    case opcodes.data:
      continueWrite(session, msg);
      break;
    case opcodes.ack:
      continueRead(session, msg);
      break;
    case opcodes.error:
      handleError(session, msg);
      break;
    default:
      console.log("Invalid opcode: %d", opcode);
      sendError(addrinfo, "Invalid opcode");
      break;
  }
};

// Initial connection handling
var tftp = dgram.createSocket("udp4", handleMsg);
console.log("Starting TFTP server");
tftp.bind(69);
console.log("TFTP server available on %s:%d", tftp.address().address,
                                              tftp.address().port);
setInterval(clearStaleSessions, 30000);
