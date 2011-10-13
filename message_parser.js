var msgs = require('./messages');
var opcodes = msgs.opcodes;

var parseAck = function(buffer) {
  var block = buffer[2] * 256 + buffer[3];
  return new msgs.Ack(block);
};

var parseData = function(buffer) {
  var block = buffer[2] * 256 + buffer[3];
  var data = buffer.slice(4);
  return new msgs.Data(block, data);
};

var parseError = function(buffer) {
  var code = buffer[2] * 256 + buffer[3];
  var msg = buffer.slice(4, buffer.length-1).toString("ascii"); 
  return new msgs.Error(code, msg); 
};

var parseRRQ = function(buffer) {
  var pmo = extractPathModeAndOptions(buffer);
  return new msgs.RRQ(pmo.path, pmo.mode, pmo.options);
};

var parseWRQ = function(buffer) {
  var pmo = extractPathModeAndOptions(buffer);
  return new msgs.WRQ(pmo.path, pmo.mode, pmo.options);
};

var extractPathModeAndOptions = function(buffer) {
  var stringAndNext = extractString(buffer, 2);
  var path = stringAndNext.string;

  stringAndNext = extractString(buffer, stringAndNext.next);
  var mode = stringAndNext.string;

  var options = {};
  var next = stringAndNext.next;
  while(next < buffer.length) {
    stringAndNext = extractString(buffer, next);
    var optionName = stringAndNext.string;
    stringAndNext = extractString(buffer, stringAndNext.next);
    var optionValue = stringAndNext.string; 
    options[optionName.toLowerCase()] = optionValue;
    next = stringAndNext.next;
  }

  return { path: path, mode: mode, options: options};
};

/*
  extractString(Buffer, Int) -> {string:string, next:int}
*/
var extractString = function(buffer, index) {
  var start = index;
  var length = buffer.length;
  for(; index < length && buffer[index] !== 0; index++);
  var strBuf = buffer.slice(start, index);
  str = strBuf.toString("ascii", 0, strBuf.length);
  return {string: str, next:index+1}; 
}

exports.messageParser = {
  parse: function(buffer) {
    if(buffer.length >= 2) {
      var opcode = buffer[0]*256 + buffer[1];
      switch(opcode) {
        case opcodes.ack:
          return parseAck(buffer);
        case opcodes.data:
          return parseData(buffer); 
        case opcodes.error:
          return parseError(buffer);
        case opcodes.read:
          return parseRRQ(buffer);
        case opcodes.write:
          return parseWRQ(buffer);
        default:
          return new msgs.Invalid(opcode);  
      } 
    } else {
      return new msgs.Invalid(0);
    }
  }
};
