# CARREFOUR DRIVE MONITOR
An helper to face COVID-19        
[FRENCH](#French)      
[ENGLISH](#English)    
[INSTALL](#INSTALL)     
#French
Le COVID-19 bouleverse nos habitudes et nous demande d'être plus prudent pour nous même et pour autrui.      
Faire ses courses aux Drive d'hypermarchés est essentiel pour des personnes âgées, des personnes possèdant un faible système immunitaire et généralement toute personne à risque.     
##Que permet ce monitor?
Il permet, à l'aide de l'API Carrefour, de détecter tous les points Drive disponibles aux alentours ou dans toute la France et de les ressencer.     
Deux modes sont pour le moment codés:     
- 1. Détection par code postal
- 2. Recensement de tous les Drive Carrefour de France et leur accessibilité actuelle     

#English
COVID-19 affects our routine and forces us to be more careful with ourselves as much as for others.     
Shop at supermarkets drive-in is essential for elderlies or people with a weak immunity system.     
##What does this monitor?
Thanks to Carrefour API, it can detect every drive-in available near your location or all around France and list them.     
Currently supporting two modes:     
- 1. Near drive-in by ZIP code     
- 2. Search for every drive-in with stock     

#INSTALL
##Requirements:    
- Python 3       
```pip3 install -r requirements.txt```
##Test:
- Rename the `config.ini.example` to `config.ini`
- Add your proxies below `[proxies]`     
- Add your postcode     
- `python3 main.py`     
###Options:
1. Monitor the stores near your location
2. Get stats about every Drive in France
