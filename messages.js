var opcodes = {
  read:  1,
  write: 2,
  data:  3,
  ack:   4,
  error: 5,
  invalid: 6
};

function Ack(block) {
  this.opcode = opcodes.ack;
  this.block = block;
}

Ack.prototype.toBuffer = function() {
  var buffer = new Buffer(5);
  buffer[0] = 0; buffer[1] = this.opcode;
  buffer[2] = (this.block >> 8) & 0xff;
  buffer[3] = this.block & 0xff;
  return buffer;
};

function Data(block, data) {
  this.opcode = opcodes.data;
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
  this.opcode = opcodes.error;
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
  this.opcode = opcodes.read;
  this.file = file;
  this.mode = mode;
  this.options = options;
}

function WRQ(file, mode, options) {
  this.opcode = opcodes.write;
  this.file = file;
  this.mode = mode;
  this.options = options;
}

exports.Error = Error;
exports.Ack = Ack;
exports.Data = Data;
exports.RRQ = RRQ;
exports.WRQ = WRQ;
exports.Invalid = Invalid;
exports.opcodes = opcodes;
