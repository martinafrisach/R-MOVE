// Estaciones (coordenadas aproximadas)
const S={
 pc:['Barcelona Plaça Catalunya',41.387,2.170],sants:['Barcelona Sants',41.379,2.140],fr:['Barcelona Estació de França',41.384,2.184],
 sa:['Sant Andreu Arenal',41.435,2.190],clot:['Barcelona Clot',41.410,2.187],aer:['Aeroport',41.305,2.073],cast:['Castelldefels',41.284,1.976],
 gran:['Granollers Centre',41.608,2.289],mat:['Mataró',41.538,2.445],aren:['Arenys de Mar',41.581,2.551],cel:['Sant Celoni',41.690,2.490],
 blan:['Blanes',41.675,2.790],mac:['Maçanet-Massanes',41.690,2.722],gir:['Girona',41.979,2.806],fig:['Figueres',42.264,2.960],port:['Portbou',42.428,3.157],
 vil:['Vilanova i la Geltrú',41.220,1.726],vfr:['Vilafranca del Penedès',41.347,1.699],svc:['Sant Vicenç de Calders',41.266,1.537],
 tar:['Tarragona',41.111,1.254],reus:['Reus',41.156,1.109],mart:['Martorell',41.474,1.932],ter:['Terrassa',41.564,2.013],
 sab:['Sabadell',41.545,2.106],cerd:['Cerdanyola Universitat',41.497,2.133],man:['Manresa',41.729,1.823],vic:['Vic',41.930,2.254],
 rip:['Ripoll',42.201,2.191],puig:['Puigcerdà',42.433,1.928],lle:['Lleida Pirineus',41.618,0.633],cerv:['Cervera',41.667,1.274],
 mora:['Móra la Nova',41.111,0.653],tort:['Tortosa',40.813,0.516],ald:['L’Aldea-Amposta',40.746,0.573],pob:['La Pobla de Segur',42.249,0.969],
 flix:['Flix',41.227,0.554],mol:['Molins de Rei',41.414,2.017]};
// Líneas: id, nombre, color, estaciones en orden
const LN=[
 ['R1','R1','#75b0e5','mol pc fr sa mat aren blan'.split(' ')],
 ['R2','R2','#00a14b','aer sants pc clot gran'.split(' ')],
 ['R2N','R2 Nord','#c3d600','mac cel gran clot pc'.split(' ')],
 ['R2S','R2 Sud','#00a14b','aer cast vil svc'.split(' ')],
 ['R3','R3','#e8541e','sants pc sa gran vic rip puig'.split(' ')],
 ['R4','R4','#f2a900','svc vfr mart sants pc ter man'.split(' ')],
 ['R7','R7','#b17bb8','cerd sab ter'.split(' ')],
 ['R8','R8','#8a1e66','mart cerd gran'.split(' ')],
 ['R11','R11','#3a7fc3','sants fr mac gir fig port'.split(' ')],
 ['R12','R12','#e0a100','lle cerv man'.split(' ')],
 ['R13','R13','#d6006e','lle cerv reus tar'.split(' ')],
 ['R14','R14','#6a9a2a','sants vfr svc tar'.split(' ')],
 ['R15','R15','#9b6b3a','reus mora flix'.split(' ')],
 ['R16','R16','#0e7c86','sants svc tar tort'.split(' ')],
 ['R17','R17','#7a4fa3','sants svc reus tort ald'.split(' ')],
 ['RG1','RG1','#2a6f4f','mac blan gir'.split(' ')],
 ['RL3','RL3','#b33a3a','sants vic rip puig'.split(' ')],
 ['RL4','RL4','#455a8c','sants man cerv lle pob'.split(' ')]
].map(([id,n,c,st])=>({id,n,c,st}));
