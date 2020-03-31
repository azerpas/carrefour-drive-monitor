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
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');

admin.initializeApp(functions.config().firebase);

const db = admin.firestore();
/*******************/

async function handleGET(req,res){
	const mode = await req.query['mode'];
	const codepostal = await req.query['zip'];
	if(mode && codepostal){
		if(mode == "loca"){
			let carrefour = new Carrefour(codepostal);
			const location = await carrefour.getLoca();
			return new Promise(resolve=>{
				if(location.lat){
					carrefour.getStores(location.lat,location.lng,codepostal)
						.then(stores => {
							resolve(res.status(200).send(JSON.stringify(stores)))
						})
						.catch(error => {
							console.log("Error while waiting for stores")
							console.error(error)
							resolve(res.status(500).send(JSON.stringify({success:false,message:"Impossible d'obtenir les magasins",error:error.message})))
						});
				}else{
					resolve(res.status(500).send(JSON.stringify({success:false,message:"Impossible d'obtenir la geolocalisation: "+location.message})))
				}
			})
			
		}
	}
	let zip = await monitor();
	await res.status(200).send(JSON.stringify(zip));
}

async function monitor(){
	let zip = [];
	let users = await db.collection('users').get();
	return users.docs.map(doc => doc.data().postcode);
}

class Carrefour{
	constructor(postcode){
		this.postcode = postcode;
		this.woosmap = "https://api.woosmap.com/localities/autocomplete/?key=woos-26fe76aa-ff24-3255-b25b-e1bde7b7a683&components=country:fr|country:mc&input="
		this.carrefourGeoloc = "https://www.carrefour.fr/geoloc"
	}

	async getLoca(){
		return new Promise(resolve => {
			const headers = {
				'authority': 'api.woosmap.com',
				'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36','accept': '*/*',
				'origin': 'https://www.carrefour.fr','sec-fetch-site': 'cross-site','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty',
				'referer': 'https://www.carrefour.fr/services/drive','accept-language': 'en,en-US;q=0.9,fr;q=0.8',
			}
			axios.get(this.woosmap+this.postcode,{headers:headers})
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

	async getStores(lat,lng,postcode){
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
			axios.get(this.carrefourGeoloc+query,{headers:headers})
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
					console.error(error)
					resolve({"success":false,"message":"Impossible de joindre Carrefour, impossible de trouver des magasins","error":error})
				});
		});
	}

}