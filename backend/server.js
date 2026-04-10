import epxress from "express"
import {createServer} from "http"
import { Server} from "socket.io"
import { YSocketIO } from "y-socket.io/dist/server"

const app = epxress()
const httpServer = createServer(app)

const io = new Server(httpServer , {
    cors:{
        origin:"*",
        METHODS : ["GET" , "POST"]
    }
})
const ySocketIo = new YSocketIO(io)
ySocketIo.initialize()

app.get( "/" , (req,res) => {
    res.status(200).json({
        message : "ok",
        success : true
    })
} )
app.get( "/health" , (req,res) => {
    res.status(200).json({
        message : "ok",
        success : true
    })
} )

httpServer.listen(3000 , ()=>{
    console.log("server is running");
})

