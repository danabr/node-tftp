var Server = require('./tftp/server').Server;

var server = new Server(69);
server.listen();
console.log("TFTP server available on %s:%d", server.address().address,
                                              server.address().port);
