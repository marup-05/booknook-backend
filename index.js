import express from "express"
import cors from "cors"

const PORT = 5000 

const app = express()
app.use(cors())
app.use(express.json())

app.get("/", (req, res)=>{
    res.send('Hello world!')
})
app.get('/test', (req, res)=>{
    res.send({msg: "test api"})
})

app.listen(PORT, ()=> {
    console.log(`server is running on port ${PORT}`);
});
