import fs from 'fs';
import request  from 'request';
import ProgressBar from 'progress';
import colors from 'colors';
import md5File from 'md5-file'
import dotenv from 'dotenv';
dotenv.config();
const endpoint = "https://api.curseforge.com",
      TOKEN = process.env.TOKEN;


var {files} = JSON.parse(fs.readFileSync(process.argv[2]));

function sortBadHash(filelist) {
    return new Promise((resolve, reject)=>{
        var bar = new ProgressBar(' [:bar] Check hashsum :percent '+colors.green(':ok')+' '+colors.red(':err'), { 
            complete: "#",
            incomplete: " ",
            total: filelist.length,
            width: 20
        });
        let err = 0,
            ok = 0,
            errMsg=[];
        let hashfin = 0,
            out = [];
        filelist.forEach(file=>{
            md5File("mods/"+file.fileName).then(hash=>{
                if(file.hash != hash) {
                    if(file.hash) errMsg.push(`${file.displayName} hash mismatch!`)
                    out.push(file)
                    err++;
                }else{
                    ok++;
                }
            }).catch(e=>{
                err++;
                errMsg.push(`${file.displayName} hash error!`)
                out.push(file)
            }).finally(()=>{
                bar.tick({ok,err})
                hashfin++;
            })
        })
        let hashwait = setInterval(()=>{
            if(hashfin==filelist.length){
                if(errMsg.length) console.log(errMsg.join("\n"))
                clearInterval(hashwait)
                resolve(out)
            }
        },500)
    })
}

function fetchList() {
    return new Promise((resolve, reject)=>{
        var bar = new ProgressBar(' [:bar] Fetching list :percent '+colors.green(':ok')+' '+colors.red(':err'), { 
            complete: "#",
            incomplete: " ",
            total: files.length,
            width: 20
        });
        let err = 0,
            ok = 0,
            errMsg=[];
        let fetchfin = 0,
            out = [];
        files.forEach(({projectID, fileID}) => {
            fetch(`${endpoint}/v1/mods/${projectID}/files/${fileID}`,{
                headers:{
                    'Accept':'application/json',
                    'x-api-key':TOKEN
                }
            }).then(async e=>{
                if(e.ok){
                    try {
                        let {data:{displayName, downloadUrl, fileName, hashes}} = await e.json();
                        out.push({
                            displayName, downloadUrl, fileName, hash:hashes.filter(({algo})=>algo==2)?.[0]?.value
                        })
                        ok++;
                        bar.tick({ok, err})
                    } catch (error) {
                        errMsg.push(`${projectID}:${fileID} | Fetch json: ${error.message}`)
                        err++;
                        bar.tick({ok, err})
                    }
                }else{
                    errMsg.push(`${projectID}:${fileID} | Fetch status: ${e.status}`)
                    err++;
                    bar.tick({ok, err})
                }
                
            }).catch(e=>{
                errMsg.push(`${projectID}:${fileID} | Fetch catch: ${e.messasge}`)
                err++;
                bar.tick({ok, err})
            }).finally(()=>{
                fetchfin++;
            })
        });

        let fetchwait = setInterval(()=>{
            if(fetchfin==files.length){
                if(errMsg.length) console.log(errMsg.join("\n"))
                clearInterval(fetchwait)
                resolve(out);
            }
        },500)
    })
    
}

function download(list) {
    return new Promise((resolve, reject)=>{
        let errMsg = [],
            out = [];
        function loop(i=0) {
            if(list[i]){
                let {displayName, downloadUrl, fileName} = list[i]
                var downloading = new ProgressBar(` [:bar] :percent | ${displayName}`, { 
                    complete: "#",
                    incomplete: " ",
                    total: 101,
                    width: 20,
                    curr: 0
                });
                downloading.tick()
                request.get(downloadUrl).on('response',(res) => {
                    let len = res.headers['content-length'],
                        downloaded = 0,
                        percent = 0,
                        file = fs.createWriteStream(`mods/${fileName}`);
                    res
                    .on('data', function(chunk) {
                        downloaded += chunk.length
                        let newPer = Math.round(100.0 * downloaded / len);
                        for (let i = 0; i < newPer-percent; i++) {
                            downloading.tick()
                        }
                        percent = newPer
                    })
                    .pipe(file)
                    .on('error', (err) => {
                        fs.unlink(`mods/${fileName}`);
                        errMsg.push("Download error: "+displayName)
                    });
                    file.on('finish',() => {
                        file.close();
                        loop(i+1);
                    })
                    file.on('error', (err) => {
                        fs.unlink(`mods/${fileName}`);
                        errMsg.push("Save error: "+displayName)
                    });
                })
            }else{
                if(errMsg.length) console.log(errMsg.join("\n"))
                resolve()
            }
        }
        loop()
    })
};

(async()=>{
    let list = await fetchList();
    let sorted = await sortBadHash(list);
    await download(sorted);
    let checked = await sortBadHash(sorted);
    if(checked.length){
        console.log(`\n ${checked.length} file(s) don't have a hash to verify integrity:`)
        checked.map(({displayName, downloadUrl, fileName, hashes})=>{
            console.log(` ${displayName}  |  ${downloadUrl}`)
        })
    }
})()