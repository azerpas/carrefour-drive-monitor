/**
 * Responds to any HTTP request.
 *
 * Redirect to handler depending on HTTP method.
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.processFbMessage = async (req, res) => {
	switch (req.method) {
	case 'GET':
		await handleGET(req, res);
		break;
	case 'POST':
		await handlePOST(req, res);
		break;
	default:
		console.error(`Unhandled http method ${req.method}`);
	}
};

/** Setting const and firebase requirements     */
const request = require('request');
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');

admin.initializeApp(functions.config().firebase);

const db = admin.firestore();
/*******************/

/**
 * Handling GET to the server
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
async function handleGET(req, res) {
	const mode = req.query['hub.mode'];
	const token = req.query['hub.verify_token'];
	const challenge = req.query['hub.challenge'];
	if (mode && token) {
		if (mode == 'subscribe' && token == process.env.VERIFY_TOKEN) {
			await res.status(200).send(challenge);
		} else {
			await res.sendStatus(403);
		}
	}else{
		await res.sendStatus(404).send("Not found :(");
	}
}

/**
 * Handling POST to the server
 * Exclusively reacting to Messenger "page" object.
 * Piling the different received messages to a Promise queue.
 * Once we receive confirmation that every message is treated we send back 200.
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
async function handlePOST(req, res) {
	 // Parse the request body from the POST
	let body = req.body;

	// Check the webhook event is from a Page subscription
	if (body.object === 'page') {

	let promiseArray = body.entry.map(entry => {
		return new Promise((resolve) => {
			let webhook_event = entry.messaging[0];
			//console.log(webhook_event);
			console.log("sender: "+webhook_event.sender.id);
			console.log("timestamp: "+webhook_event.timestamp);
			console.log("recipient: "+webhook_event.recipient.id);
			console.log("message: "+webhook_event.message.text);
			if(!webhook_event.message.text){
				resolve(false);
			}else{
				resolve(handleMessage(webhook_event.sender.id,webhook_event.message, webhook_event.timestamp));
			}
		});
	});
	Promise.all(promiseArray).then(() => {
		console.log('done')
		res.status(200).send('EVENT_RECEIVED');
	});
	// Return a '200 OK' response to all events

	} else {
	// Return a '404 Not Found' if event is not from a page subscription
	res.sendStatus(404);
	}
}

/**
 * Handling POST to the server
 * Exclusively reacting to Messenger "page" object.
 * Piling the different received messages to a Promise queue.
 * Once we receive confirmation that every message is treated we send back 200.
 * @param int sender_psid Facebook identifier for the sender.
 * @param {!messenger:Webhook.Message} Messenger object text message.
 * @param int timestamp sent at.
 */
async function handleMessage(sender_psid, received_message, timestamp) {
	let response;
	console.log("HANDLING");
	if(isInfos(received_message.text)){
		console.log("ASKING FOR INFOS");
		response = {
			"text": `Ok we're searching for your infos!`
		}
		console.log("SENDING")
		let a = callSendAPI(sender_psid, response);
		console.log("SENT")
		let users = db.collection('users');
		let snapshot = await users.where('psid', '==', sender_psid).get();
		if(snapshot.empty){
			console.log('No matching documents.');
			response = {
				"text": `We can't find you... 😢`
			}
			return callSendAPI(sender_psid, response);
		}
		for(doc of snapshot.docs){
			console.log(doc.id, '=>', doc.data());
			response = {
				"text": `Found you! Mister ${doc.id}`
			}
			return callSendAPI(sender_psid, response);
		}
	}
	
	else if (!(isPostCode(received_message.text))) {		
		// Create the payload for a basic text message
		response = {
			"text": `🤖 Je n'ai pas compris votre demande.\nMerci de saisir un code postal français valide.`
		}
		return callSendAPI(sender_psid, response);
	}
	else if(isPostCode(received_message.text)){
		let users = db.collection('users');
		let snapshot = await users.where('psid', '==', sender_psid).get();
		let a = askStores(sender_psid,received_message.text.trim())
		if(snapshot.empty){
			console.log("User not in database so we're adding him!")
			let doc = await addUser( sender_psid, timestamp, received_message.text.trim());
			console.log(`ID received by firestore: ${doc}`);
			response = {
				"text": `Merci! Vous êtes maintenant enregistré sous l'ID: "${doc}". \n Nous vous recontacterons si nous trouvons des disponibilités autour de chez vous! 😄\nBon courage! 💪`
			}
			return callSendAPI(sender_psid, response);
		}else{
			for(doc of snapshot.docs){
				console.log("ALREADY INSIDE THE DB");
				// vous êtes ddéjà dans la bd
				response = {
					"text": `Vous êtes déjà dans la base de données!\nNous modifions donc votre code postal... 📝 `
				}
				let a = callSendAPI(sender_psid, response);
				// update avec un nouveau postcode
				let update = await users.doc(doc.id).update({postcode:received_message.text.trim()});
				response = {
					"text": `C'est bon!✅\nVotre code postal a bien été modifié.\nVous recevrez des alertes dès que des Drive autour de chez vous auront des disponibilités! 🚘`
				}
				return callSendAPI(sender_psid, response);
			}
			
		}
		
	}			
}

/**
 * Calling the Facebook API to send a message
 * @param int sender_psid Facebook identifier for the sender.
 * @param string response text to send.
 */
async function callSendAPI(sender_psid, response) {
	// Construct the message body
	let request_body = {
		"recipient": {
			"id": sender_psid
		},
		"message": response
	}
	request({
		"uri": "https://graph.facebook.com/v6.0/me/messages",
		"qs": { "access_token": process.env.PAGE_TOKEN },
		"method": "POST",
		"json": request_body
	}, (err, res, body) => {
		if (!err) {
			console.log('message sent!');
		} else {
			console.error("Unable to send message:" + err);
		}
	}); 
}

/*
 * Return if str is a valid french postcode
 * @param string str
 */
function isPostCode(str){
	return /^([0-9]{5})$/.test(str.trim());
}

/*
 * Return if str contains "info"
 * @param string str
 */
function isInfos(str){
	return str.trim().toLowerCase().match(/(info)/);
}

/**
 * Adding data to Cloud Firestore
 * @param int psid Facebook identifier for the sender.
 * @param int timestamp sent at.
 * @param string postcode given postcode.
 */
async function addUser(psid,timestamp,postcode){
	let addDoc = await db.collection('users').add({
		psid: psid,
		timestamp: timestamp,
		lastAsked: 0,
		lastPosted: 0,
		postcode: postcode 
	});
	console.log('Added document with ID: ', addDoc.id);
	return addDoc.id;
}

async function askStores(psid,postcode){
	// asking our endpoint process.env.monitor
	console.log("asking endpoint")
	let response = await axios.get(process.env.monitor+`?mode=loca&zip=${postcode}`)
		.catch(error=>{
			response = {
				"text": `Nous n'arrivons pas à contacter les Drive 😞`
			}
			console.error("Error")
			console.error(error)
			return callSendAPI(psid, response);
		});
	for(store of response.data){
		if(store.availability != null){
			console.log(store.availability)
			response = { //"2020-04-08T10:00:00+0200"
				"text": `🚨Nous avons trouvé un magasin! ${store.store.name} à ${store.store.distance} km de votre localisation!\n🗓 Prochaine disponibilité: ${store.availability}\n📍${store.store.address.address1}, ${store.store.address.city} ${store.store.address.cityCode}`
			}
			callSendAPI(psid,response)
		}
	}
	// sending results to psid & return promise
	response = {
		"text": `Nous vous contacterons dès que des magasins auront des disponibilités!`
	}
	return callSendAPI(psid, response);
}