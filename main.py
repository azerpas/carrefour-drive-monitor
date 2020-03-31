import requests, random, datetime, json, threading, time, sys
from configparser import ConfigParser
configparser = ConfigParser(delimiters=('='),allow_no_value=True)

stores = []
storesErr = []
countAvail = 0
countNotAvail = 0

api = "https://www.carrefour.fr/api/firstslot?storeId="

headers = {
	'Host': 'www.carrefour.fr','accept': 'application/json, text/plain, */*','user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36',
	'x-requested-with': 'XMLHttpRequest', # needed to get redirected to their Ajax Controller
	'sec-fetch-site': 'same-origin','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty','referer': 'https://www.carrefour.fr/', 'accept-language': 'en,en-US;q=0.9,fr;q=0.8',
}


def log(event):
	d = datetime.datetime.now().strftime("%H:%M:%S")
	print("@azrpas :: " + str(d) + " :: " + event)

def grabProxies():
	configparser.read('config.ini')
	proxies = list(configparser.items('proxies'))
	log("Found "+str(len(proxies))+" proxies")
	return proxies

def getLoca(postcode):
	headers = {
		'authority': 'api.woosmap.com',
		'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36','accept': '*/*',
		'origin': 'https://www.carrefour.fr','sec-fetch-site': 'cross-site','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty',
		'referer': 'https://www.carrefour.fr/services/drive','accept-language': 'en,en-US;q=0.9,fr;q=0.8',
	}
	params = (
		('key', 'woos-26fe76aa-ff24-3255-b25b-e1bde7b7a683'),
		('input', postcode),
		('components', 'country:fr|country:mc'),
	)

	try:
		response = requests.get('https://api.woosmap.com/localities/autocomplete/', headers=headers, params=params, timeout=30)
	except Exception as e:
		log("Error while getting the local. Please check your internet access.")
		print(e)
		return False
	if(response.status_code == 200):
		return response.json()["localities"][0]["location"] # = {"lat": 48.791378, "lng": 2.6660678}
	else:
		log("Seems like the request to get locals went wrong")
		return False

def getStores(locations,postcode):
	headers = {
		'authority': 'www.carrefour.fr', 'accept': 'application/json, text/plain, */*',
		'x-requested-with': 'XMLHttpRequest', 'adrum': 'isAjax:true',
		'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.69 Safari/537.36',
		'sec-fetch-site': 'same-origin','sec-fetch-mode': 'cors','sec-fetch-dest': 'empty',
		'referer': 'https://www.carrefour.fr/services/drive','accept-language': 'en,en-US;q=0.9,fr;q=0.8'
	}
	params = (
		('lat', locations["lat"]),
		('lng', locations["lng"]),
		('page', '1'),
		('limit', '5'),
		('postal_code', postcode),
		('array_postal_codes[]', postcode),
		('modes[]', ['delivery', 'picking']),
	)
	try:
		response = requests.get('https://www.carrefour.fr/geoloc', headers=headers, params=params)
	except Exception as e:
		log("Error while getting the stores from Carrefour. Please check your internet access.")
		print(e)
		return False
	if(response.status_code == 200):
		try:
			response.json()
		except Exception as e:
			log("Can't read JSON")
			if("maintenance" in response.text.lower()):
				log("Carrefour is in maintenance, will be waiting an hour.")
				time.sleep(3600)
				getStores(locations,postcode)
			else:
				print(response.text)
			return False
		stores = response.json()["data"]["stores"]
		if(len(stores) == 0):
			log("Can't find any store... Please check your settings!")
			return False
		log("Found "+str(len(stores))+" stores")
		return stores
	else:
		log("Seems like the request to get locals went wrong")
		return False


def getStore(store,proxy):
	global stores
	global storesErr
	global countAvail
	global countNotAvail
	s = requests.session()
	try:
		r = s.get(api+str(store),headers=headers,proxies=proxy,timeout=10)
	except requests.exceptions.Timeout:
		log("Timeout, retrying...")
		return getStore(store,proxy)
	except requests.exceptions.ConnectionError:
		log("Connection error, retrying...")
		return getStore(store,proxy)
	except requests.exceptions.ProxyError:
		log("Connection error, retrying...")
		return getStore(store,proxy)
	except Exception as e:
		return {"store":None,"availability":None,"error":True,"message":repr(e)}
	try:
		r.json() # testing if json can be read
	except Exception as e:
		log("Can't read JSON")
		print(r.status_code)
		if("maintenance" in r.text.lower()):
			log("Carrefour is in maintenance, will be waiting an hour.")
			time.sleep(3600)
		else:
			print(r.text)
		return {"store":None,"availability":None,"error":True,"message":r.text}
	if(r.json() == []): # usually the response when a store have no stock
		print("Store but empty")
		return {"store":store,"availability":None,"error":False}
	elif(('data' in r.json())): 
		if(('type' in r.json()['data']) and (r.json()['data']['type'] == "first_slot")): ## found availability
			print("Store has availability")
			return {"store":store,"availability":r.json()['data']['attributes']['begDate'],"error":False}
		else: # unknown json
			print("ERROR 1")
			print(r.status_code)
			print(r.json())
			return {"store":store,"availability":None,"error":True,"message":r.text}
	else: # either not containing 'data' key or not '[]', unknown error for now
		print("ERROR 2")
		print(r.status_code)
		print(r.json())
		return None

def monitorStores(stores,proxy):
	for i in stores:
		result = getStore(i["ref"],proxy)
		if(result == None):
			continue
		elif(result["error"] == True):
			print(result["message"])
			continue
		elif(result["error"] == False):
			if(result["availability"] == None):
				log("No availability at "+i["name"])
				continue
			else:
				try:
					print("\n-------------------------------------------------")
					log("Found store with availability !")
					print(i["name"]+" à "+i["distance"]+"km")
					print(i["address"]["address1"]+" - "+i["address"]["city"])
					print(i["address"]["cityCode"])
					print("-------------------------------------------------\n")
				except Exception as e:
					log("Error while printing store")
					print(e)
				continue

def launchTask(rang,proxies,taskId):
	global stores
	global storesErr
	global countAvail
	global countNotAvail
	nbLoop = 1000
	lck = threading.Lock()
	for i in range(rang,rang+100):
		log(str(i)+"/"+str(nbLoop))
		pr = random.choice(proxies)[0] # [0] cause of tuple format given by config parser
		proxy = {"http":"http://"+pr,"https":"https://"+pr}
		log("THREAD "+str(taskId)+" : "+"Using proxy: "+proxy["http"])
		result = getStore(i,proxy)
		log("THREAD "+str(taskId)+" : "+"Sleeping 7 seconds before next request")
		time.sleep(7)
		lck.acquire()
		if(result == None):
			lck.release()
			continue
		elif(result["error"] == True):
			print(result["message"])
			storesErr.append({"store":result["store"],"availability":None})
			lck.release()
			continue
		elif(result["error"] == False):
			if(result["availability"] == None):
				log("THREAD "+str(taskId)+" : "+"Found store: No availability")
				countNotAvail += 1
				stores.append({"store":result["store"],"availability":None})
				lck.release()
				continue
			else:
				log("THREAD "+str(taskId)+" : "+"Found store: Availability")
				countAvail += 1
				stores.append({"store":result["store"],"availability":result["availability"]})
				lck.release()
				continue

def main():
	global stores
	global storesErr
	global countAvail
	global countNotAvail
	proxies = grabProxies()
	print("Carrefour Drive helper by @azrpas")
	print("1. To monitor your area (add your postcode to config.ini)")
	print("2. To get some stats about active Carrefour Drive")
	answer = input("> ").strip()
	if(int(answer) == int(1)):
		configparser.read('config.ini')
		postcode = configparser.get("options","postcode")
		result = getLoca(postcode)
		if(result == False):
			log("Can't get localisation, please check your parameters. Exiting.")
			sys.exit(1)
		result = getStores(result,postcode)
		if(result == False):
			log("Can't get stores after localisation, please check your parameters. Exiting.")
			sys.exit(1)
		while(True):
			pr = random.choice(proxies)[0]
			log("Checking your stores")
			proxy = {"http":"http://"+pr,"https":"https://"+pr}
			monitorStores(result,proxy)
			log("Sleeping a minute before checking again")
			time.sleep(60)
	elif(int(answer) == 2):
		rang = 0
		threads = []
		for i in range(0,10):
			log("Launching thread "+str(i))
			t = threading.Thread(target=launchTask, kwargs={"rang":rang,"proxies":proxies,"taskId":i})
			threads.append(t)
			t.start()
			rang += 100
		
		#save to file 
		for t in threads:
			t.join()
		log(str(countAvail)+" magasins ont leur fonctionnalité Carrefour Drive active")
		log(str(countNotAvail)+" magasins ont leur fonctionnalité Carrefour Drive désactivée")
		try:
			with open('stores.json', 'w') as f:
				toJson = {"stores":stores,"lastFetchedAt":datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")}
				json.dump(toJson, f)
			log("Successfully saved the stores 1/2")
		except Exception as e:
			log("Can't save them to JSON. Here's the error and the stores:")
			print(e)
			print(stores)
		try:
			with open('storesErr.json', 'w') as f:
				toJsonErr = {"stores":storesErr,"lastFetchedAt":datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")}
				json.dump(toJsonErr, f)
			log("Successfully saved the stores 2/2")
		except Exception as e:
			log("Can't save them to JSON. Here's the error and the stores:")
			print(e)
			print(storesErr)
	else:
		log("Please enter a proper value. Rebooting...")
		return main()
	
	
main()