/**
 * Responds to any HTTP request.
 *
 * Redirect to handler depending on HTTP method.
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.processMonitor = async (req, res) => {
	switch (req.method) {
	case 'GET':
		await handleGET(req, res);
		break;
	default:
		console.error(`Unhandled http method ${req.method}`);
		await res.sendStatus(403);
	}
};

/** Setting const and firebase requirements */
const request = require('request');
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');
let httpsProxyAgent = require('https-proxy-agent');

admin.initializeApp(functions.config().firebase);

const db = admin.firestore();
/*******************/

async function getProxy(){
	let pr = process.env.ROTATING_PROXY.split(":");
	if(pr.length == 4){
		/*
		return { 
			host: pr[0], 
			port: pr[1], 
			auth: { 
				username: pr[0] === "zproxy.lum-superproxy.io" ? pr[2]+"-session-"+Math.random()*10000 : pr[2], 
				password: pr[3] } 
			}
		*/
		return new httpsProxyAgent(`http://${pr[0] === "zproxy.lum-superproxy.io" ? pr[2]+"-session-"+Math.random()*10000 : pr[2]}:${pr[3]}@${pr[0]}:${pr[1]}`);
	}else if(pr.length == 2){
		return new httpsProxyAgent(`http://${pr[0]}:${pr[1]}`);
	}else { console.error("No proxy defined, please input one"); process.exit(1); }
}

async function handleGET(req,res){
	
	// Analysing request queries
	const mode = await req.query['mode'];
	const codepostal = await req.query['zip'];
	// ######################################

	if(mode && codepostal){
		/** @Route("/?mode=loca&zip=75000") */
		if(mode == "loca"){
			let carrefour = new Carrefour(codepostal);
			const location = await carrefour.getLoca();
			if(location.lat){
				let stores = await carrefour.getStores(location.lat,location.lng,codepostal)
				let availabilities = [];
				for(let store of stores){
					availabilities.push(await carrefour.getAvailability(store));
				}
				return new Promise(resolve=>{
					resolve(res.status(200).send(JSON.stringify(availabilities)))
				})
			}else{
				return new Promise(resolve=>{
					resolve(res.status(500).send(JSON.stringify({success:false,message:"Impossible d'obtenir la geolocalisation: "+location.message})))
				})
			}
		}
		/** @Route("/?mode=GUBZ&zip=75000") */
		if(mode == "GUBZ"){ // get user by zip
			let users = await getUsersByZip(codepostal)
			return new Promise(resolve=>{
				resolve(res.status(200).send(JSON.stringify(users)))
			})
		}
	}
	/** @Route("/?mode=alert") */
	else if(mode === "alert"){
		let uniquePostcodes = await getPostcodes();
		let promiseArray = uniquePostcodes.map(zip => {
			return new Promise((resolve) => {
				resolve(check(zip))
			});
		});
		Promise.all(promiseArray).then(() => {
			console.log('Verified for each zip code')
			res.status(200).send('EVENT_RECEIVED');
		});
	}
	else{
		/** @Route("/") */
		console.log("Not getting there")
		let zip = await getPostcodes();
		await res.status(200).send(JSON.stringify(zip));
	}
}


/**
 * Return every postcode inside the database
 * @return {[]} of unique postcodes
 */
async function getPostcodes(){
	let users = await db.collection('users').get();
	// new Set is filtering duplicates
	return [...new Set(users.docs.map(doc => doc.data().postcode))];
}

/**
 * Retrieve users from postcode. Used when contacting people from one location.
 * @param {string} postcode french
 * @return {[]} array of users 
 */
async function getUsersByZip(postcode){
	console.log("Getting users")
	let users = await db.collection('users').where('postcode','==',postcode).get()
	if(users){
		return users.docs.map(doc => doc.data().psid)
	}else{
		console.error("No users found with postcode")
		console.error(postcode)
		return []
	}
}

async function alert(psid,availabilities){
	for (let store of availabilities) {
		if(store.availability != null){
			console.log("Sending to "+psid)
			let request_body = {
				"recipient": { "id": psid },
				"message": {  "text": `🚨Nous avons trouvé un magasin! ${store.store.name} à ${store.store.distance} km de votre localisation!\n🗓 Prochaine disponibilité: ${store.availability}\n📍${store.store.address.address1}, ${store.store.address.city} ${store.store.address.cityCode}` }
			}
			request({
				"uri": "https://graph.facebook.com/v6.0/me/messages",
				"qs": { "access_token": process.env.PAGE_TOKEN },
				"method": "POST",
				"json": request_body
			}, (err, res, body) => {
				if (!err) { console.log('message sent!'); } 
				else { console.error("Unable to send message:" + err); }
			});
		}
	}
}

async function check(zip){
	// Carrefour
	console.log("Checking Carrefour")
	let carrefour = new Carrefour(zip);
	const location = await carrefour.getLoca();
	const stores = await carrefour.getStores(location.lat,location.lng,zip);
	let availabilities = [];
	for(let store of stores){
		availabilities.push(await carrefour.getAvailability(store));
	}
	if(availabilities != []){
		let people = await getUsersByZip(zip);
		for (const ppl of people) {
			alert(ppl,availabilities)
		}
	}
}

/**
 * @class Carrefour Drive in
 * 3 methods to retrieve availability
 * @method getLoca
 * @method getStores
 * @method getAvailability
 */
class Carrefour{
	constructor(postcode){
		this.postcode = postcode;
		this.woosmap = "https://api.woosmap.com/localities/autocomplete/?key=woos-26fe76aa-ff24-3255-b25b-e1bde7b7a683&components=country:fr|country:mc&input="
		this.carrefourGeoloc = "https://www.carrefour.fr/geoloc"
		this.availability = "https://www.carrefour.fr/api/firstslot?storeId="
	}

	/**
	 * Retrieving coordinates with a given postcode
	 * @return {Promise}
	 */
	async getLoca(){
		let proxy = await getProxy();
		return new Promise(resolve => {
			const headers = {
				'authority': 'api.woosmap.com',
				'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36','accept': '*/*',
				'origin': 'https://www.carrefour.fr','sec-fetch-site': 'cross-site','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty',
				'referer': 'https://www.carrefour.fr/services/drive','accept-language': 'en,en-US;q=0.9,fr;q=0.8',
			}
			axios.get(this.woosmap+this.postcode,{headers:headers,httpsAgent:proxy})
				.then(response => {
					if(response.status === 200){
						if(response.data.localities[0]){
							resolve(response.data.localities[0].location) // = {"lat": 48.791378, "lng": 2.6660678}
						}else{
							resolve({"success":false,"message":"Le code postal ne retourne aucun résultat"})
						}
					}
					else{
						console.error("Seems like the request to get locals went wrong 1")
						console.error(response.status)
						console.error(response.data)
						resolve({"success":false,"message":"Impossible de joindre le serveur de récupération de localisation"})
					}
				})
				.catch(error => {
					console.error("Seems like the request to get locals went wrong 2")
					console.error(error)
					resolve({"success":false,"message":"Impossible de joindre le serveur de récupération de localisation","error":error})
				});
		});
	}

	/**
	 * @param {*} lat latitude
	 * @param {*} lng longitude
	 * @param {*} postcode french postcode
	 * @return {Promise} with array of stores
	 */
	async getStores(lat,lng,postcode){
		let proxy = await getProxy();
		const self = this;
		return new Promise(resolve => {
			console.log("Getting the stores")
			const headers = {
				'authority': 'www.carrefour.fr', 'accept': 'application/json, text/plain, */*',
				'x-requested-with': 'XMLHttpRequest', 'adrum': 'isAjax:true',
				'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36',
				'sec-fetch-site': 'same-origin','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty',
				'referer': 'https://www.carrefour.fr/services/drive','accept-language': 'en,en-US;q=0.9,fr;q=0.8'
			}
			const query = `?lat=${lat}&lng=${lng}&page=1&limit=5&postal_code=${postcode}&array_postal_codes%5B%5D=${postcode}&modes%5B%5D=delivery&modes%5B%5D=picking`
			axios.get(this.carrefourGeoloc+query,{headers:headers,httpsAgent:proxy})
				.then(response => {
					if(response.data.data){
						const stores = response.data.data.stores;
						if(stores.length != 0){
							resolve(stores)
						}else{
							resolve({"success":false,"message":"Impossible de trouver un magasin autour de chez vous chez Carrefour."})
						}
					}
					else{
						if(response.data.contains("maintenance")){
							console.error("Carrefour est en maintenance pour le moment")
							console.error(response.status)
							resolve({"success":false,"message":"Carrefour est en maintenance pour le moment"})
						}else{
							console.error("Erreur inconnue, impossible de joindre Carrefour")
							console.error(response.status)
							resolve({"success":false,"message":"Erreur inconnue, impossible de joindre Carrefour"})
						}
					}
				})
				.catch(error => {
					console.error("Seems like the request to get stores went wrong")
					console.error(error.response.status)
					console.error(error.response.data)
					if(error.response.status == 403){
						console.log("Retrying because of 403...")
						resolve(self.getStores(lat,lng,postcode));
					}
					resolve({"success":false,"message":"Impossible de joindre Carrefour, impossible de trouver des magasins","error":error})
				});
		});
	}

	/**
	 * @param {object} store carrefour type object
	 * @return {object} store with availability
	 */
	async getAvailability(store){
		let proxy = await getProxy();
		return new Promise(resolve => {
			const headers = {
				'Host': 'www.carrefour.fr','accept': 'application/json, text/plain, */*','user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36',
				'x-requested-with': 'XMLHttpRequest', // needed to get redirected to their Ajax Controller
				'sec-fetch-site': 'same-origin','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty','referer': 'https://www.carrefour.fr/', 'accept-language': 'en,en-US;q=0.9,fr;q=0.8',
			}
			//console.log(store)
			axios.get(this.availability+store.ref,{headers:headers,httpsAgent:proxy})
				.then(response => {
					if(response.data.data){
						if(response.data.data.type){
							console.log("Found availability "+store.ref)
							resolve({"store":store,"availability":response.data.data.attributes.begDate,"error":false})
						}else{ 
							console.log("Can't find availability...")
							resolve({"store":store,"availability":null,"error":true,"message":response.data})
						}
					}
					else if(JSON.stringify(response.data) === '[]'){
						resolve({"store":store,"availability":null,"error":false})
					}
					else{
						if(JSON.stringify(response.data).includes("maintenance")){
							console.error("Carrefour est en maintenance pour le moment")
							console.error(response.status)
							resolve({"success":false,"message":"Carrefour est en maintenance pour le moment"})
						}else{
							console.error("Erreur inconnue, impossible de joindre Carrefour")
							console.error(response.status)
							console.error(response.data)
							resolve({"success":false,"message":"Erreur inconnue, impossible de joindre Carrefour"})
						}
					}
				})
				.catch(error => {
					console.error("Seems like the request to get stores went wrong")
					console.error(error)
					resolve({"success":false,"message":"Impossible de joindre Carrefour, impossible de trouver des magasins","error":error})
				});
		});
	}
}