const {app,BrowserWindow,session}=require('electron');

let win;
function createWindow(){
  win=new BrowserWindow({width:1440,height:920,minWidth:980,minHeight:700,backgroundColor:'#080c1c',webPreferences:{contextIsolation:true,nodeIntegration:false}});
  win.loadURL(process.env.AVA_DESKTOP_URL||'https://personal-project-assistant.onrender.com/');
  win.on('close',event=>{if(!app.isQuitting){event.preventDefault();win.hide()}});
}
app.whenReady().then(()=>{
  session.defaultSession.setPermissionRequestHandler((webContents,permission,callback)=>callback(permission==='media'));
  createWindow();
});
app.on('window-all-closed',()=>{});
