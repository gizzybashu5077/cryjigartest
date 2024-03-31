var mysql  = require('mysql');

var db_config = {
  connectionLimit : 3,
  host     : 'bnbrn611jhld2mgh4f9w-mysql.services.clever-cloud.com',
  user     : 'uy70tyqzlbm9mtw0',
  password : 'uuvWv8lmpkqoNiLfOHne',
  database:'bnbrn611jhld2mgh4f9w'
};

//- Create the connection variable
var connection = mysql.createPool(db_config);

//- Establish a new connection
connection.getConnection(function(err,data){
  if(err) {
      // mysqlErrorHandling(connection, err);
      console.log("\n\t ***RECONNECTING: Cannot establish a connection with the database. ***");

      // data.release();
	  	console.log(' Error getting mysql_pool connection: ' + err);
	  	//throw err;
       connection = reconnect(connection);
  }else {
    data.release();

      console.log("\n\t *** New connection established with the database. ***")
  }
});

//- Reconnection function
function reconnect(connection){
  console.log("\n New connection tentative...");

  //- Destroy the current connection variable
  if(connection) connection.destroy();

  //- Create a new one
  var connection = mysql.createPool(db_config);

  //- Try to reconnect
  connection.getConnection(function(err,data){
      if(err) {
        data.release();
          //- Try to connect every 2 seconds.
          setTimeout(reconnect, 5000);
      }else {
          console.log("\n\t ***RECONNECTING: New connection established with the database. ***")
          return connection;
      }
  });
}

//- Error listener
connection.on('error', function(err) {

  //- The server close the connection.
  if(err.code === "PROTOCOL_CONNECTION_LOST"){    
      console.log("/!\\ Cannot establish a connection with the database. /!\\ ("+err.code+")");
      connection = reconnect(connection);
  }

  //- Connection in closing
  else if(err.code === "PROTOCOL_ENQUEUE_AFTER_QUIT"){
      console.log("/!\\ Cannot establish a connection with the database. /!\\ ("+err.code+")");
      connection = reconnect(connection);
  }

  //- Fatal error : connection variable must be recreated
  else if(err.code === "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"){
      console.log("/!\\ Cannot establish a connection with the database. /!\\ ("+err.code+")");
      connection = reconnect(connection);
  }

  //- Error because a connection is already being established
  else if(err.code === "PROTOCOL_ENQUEUE_HANDSHAKE_TWICE"){
      console.log("/!\\ Cannot establish a connection with the database. /!\\ ("+err.code+")");
  }

  //- Anything else
  else{
      console.log("/!\\ Cannot establish a connection with the database. /!\\ ("+err.code+")");
      connection = reconnect(connection);
  }

});
module.exports = connection;
