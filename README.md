# Table of content

- [Introduction](#introduction)
- [Installation](#installation)
- [Usage](#usage)
- [Compiling](#compiling)
- [Contributing](#contributing)
- [License](#license)

## Introduction
This project is a barebone but efficient template for an API in typescript made with the precious help of [Bylife](https://github.com/Bylife)
- It uses a custom routing system and is built to use it along MongoDB, MYSQL or any other type of SQL database.
- It comes by default with multiple types of requests: http and wss(websockets)

## Installation
Make sure you have installed **typescript** on your system and **npm**, then head over to the root of the project and type ```npm install```
<br>
You **need** to create a .env file and add the database tokens just like in the .env.example
<br><br>
If you have any problems with the installation, you can open an issue in this repository.

## Tests set up
you'll find a dedicated tests folder where you can write and execute your unit tests. This folder is designed to contain all your test scripts to ensure proper testing of your codebase
<br>
Install : ```npm install --save-dev jest @types/jest ts-jest```
<br>
Run : ```npx jest```

## Usage
Run ```nodemon index.ts``` to run the project !

## Compiling
Run ```tsc --outDir ./dist``` to compile the project, the compiled files will be in the dist folder.

## Contributing
If you want to contribute to this project you can fork this repository and make a pull request with your changes.
Anyone is welcome to contribute to this project.

## License
This project is under the MIT license.





**/wallet/transaction/recent [GET]**

à besoin du token en bearer

ressors les transacs de -24h sur les différents wallets, type de réponse:

		  ``` [{
                        username                       
			wallet
                        tokenSymbol
                        hash
                        gasUsed
          }, {...}]```




**/wallet/create [POST]**

besoin du bearer +
post: username, wallets  (sous forme d'un tableau de string en mode ["0x5", "..."])

réponse: ressors l'objet du wallet créé
PS: S'il détecte qu'un utilisateur a été réutilisé, il va juste ajouter les wallets du tableau envoyé donc sa sert aussi comme route pour ajouter des wallets à un username et pas que créer



**/wallet/list [GET]**

besoin du bearer

pas besoin d'expliquer, sa ressort tous les wallets créés 


**/user/get [POST]**

besoin du bearer

post: username

ressors les infos d'un user


**/user/delete [POST]**

besoin du bearer

post: username

delete un user via username 


**/user/create [POST]**

besoin du bearer

post: username

créer un utilisateur et génére un jwt pour lui
réponse: ressors les infos de l'utilisateur avec son bearer
```
{
_id
username
token
}

```
