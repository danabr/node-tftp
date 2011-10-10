var opcodes = {
  read:  1,
  write: 2,
  data:  3,
  ack:   4,
  error: 5,
  invalid: 6
};

function Ack(block) {
  this.block = block;
}

Ack.prototype.toBuffer = function() {
  var buffer = new Buffer(5);
  buffer[0] = 0; buffer[1] = opcodes.ack; // OpCode
  buffer[2] = (this.block >> 8) & 0xff;
  buffer[3] = this.block & 0xff;
  return buffer;
};

function Data(block, data) {
  this.block = block;
  this.data = data;
}

Data.prototype.toBuffer = function() {
  var buffer = new Buffer(this.data.length + 4);
  buffer[0] = 0; buffer[1] = opcodes.data; // OpCode
  buffer[2] = (this.block >> 8) & 0xff;
  buffer[3] = this.block & 0xff; 
  this.data.copy(buffer, 4, 0, this.data.length);
  return buffer;
};

function Error(code, msg) {
  this.code = code;
  this.message = msg;
}

Error.prototype.toBuffer = function() {
  // Note: We assume message is ASCII
  var buffer = new Buffer(this.message.length + 5);
  buffer[0] = 0; buffer[1] = opcodes.error; // OpCode
  buffer[2] = (this.code >> 8) & 0xff; 
  buffer[3] = this.code & 0xff;
  buffer.write(this.message, 4, this.message.length);
  buffer[buffer.length-1] = 0;
  return buffer;
};

function Invalid(opcode) {
  this.opcode = opcode;
}

function RRQ(file, mode, options) {
  this.file = file;
  this.mode = mode;
  this.options = options;
}

function WRQ(file, mode, options) {
  this.file = file;
  this.mode = mode;
  this.options = options;
}

var parse = function(buffer) {
  if(buffer.length >= 2) {
    var opcode = buffer[0]*256 + buffer[1];
    switch(opcode) {
      case opcodes.ack:
        return parseAck(buffer);
      case opcodes.data:
        return parseData(buffer); 
      case opcodes.error:
        return parseError(buffer);
      case opcodes.rrq:
        return parseRRQ(buffer);
      case opcodes.wrq:
        return parseWRQ(buffer);
      default:
        return new Invalid(opcode);  
    } 
  } else {
    return new Invalid(0);
  }
};

exports.Error = Error;
exports.Ack = Ack;
exports.Data = Data;
exports.RRQ = RRQ;
exports.WRQ = WRQ;
exports.Invalid = Invalid;
exports.parse = parse;
