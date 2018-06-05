var express = require('express');
var querystring = require('querystring');
var ejs = require('ejs');
var SpotifyWebApi = require('spotify-web-api-node');
var randomstring = require("randomstring");
var cookieParser = require('cookie-parser');
var cors = require('cors');
var request = require('request');

var app = express();

app.use(express.static(__dirname + '/public'))
    .use(cors())
    .use(cookieParser());

app.set('views', __dirname + '/views')
    .set('view engine', 'ejs');

var spotify_client_id = '6789cda33821496080d428075ff99d95',
    spotify_client_secret = '66ed346771fe492c9ed0323cd59d840a',
    spotify_redirect_uri = 'https://0461f5c2.ngrok.io/spotify/callback',
    spotify_scopes = 'user-library-read user-library-modify playlist-read-private playlist-modify-public playlist-modify-private playlist-read-collaborative user-read-recently-played user-top-read user-read-private user-read-email user-read-birthdate user-modify-playback-state user-read-currently-playing user-read-playback-state user-follow-modify user-follow-read';

var spotifyApi = new SpotifyWebApi({
    clientId: spotify_client_id,
    clientSecret: spotify_client_secret,
    redirectUri: spotify_redirect_uri
});


app.get('/', function(req, res) {

    var error = req.cookies['error'];
    res.clearCookie('error');


    console.log(error);

    res.setHeader('Content-Type', 'text/html');
    res.render('home', {error : error});

});

app.get('/spotify/login', function(req, res) {

    var state = randomstring.generate(16);
    res.cookie('stateKey', state);

    // Requête pour autoriser l'utilisateur à utiliser Spotify sur cette application
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: spotify_client_id,
            scope: spotify_scopes,
            redirect_uri: spotify_redirect_uri,
            state: state
        }));

});

app.get('/spotify/callback', function(req, res) {

    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies['stateKey'] : null;

    if (state === null || state !== storedState) { // impossible de récupérer le code d'autorisation passé en paramètre
        res.cookie('error', 'Code du status invalide');
        res.redirect('/');

    } else { // code l'autorisation récupéré !!!
        res.clearCookie('stateKey');

        // Options de la requête pour récupérer le token
        var authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: 'https://0461f5c2.ngrok.io/spotify/callback',
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer.from((spotify_client_id + ':' + spotify_client_secret)).toString('base64'))
            },
            json: true
        };

        // Requête pour récupérer le token Spotify
        request.post(authOptions, function(error, response, body) {
            if (!error && response.statusCode === 200) {

                var access_token = body.access_token,
                    refresh_token = body.refresh_token;

                spotifyApi.setAccessToken(access_token);
                spotifyApi.setRefreshToken(refresh_token);

                var options = {
                    url: 'https://api.spotify.com/v1/me',
                    headers: { 'Authorization': 'Bearer ' + access_token },
                    json: true
                };

                // use the access token to access the Spotify Web API
                request.get(options, function(error, response, body) {
                    //console.log(body);
                });

                var user_id;
                spotifyApi.getMe()
                    .then(function(data) {
                        //console.log('Some information about the authenticated user', data.body);
                        user_id = data.body.id;
                    }, function(err) {
                        console.log('Something went wrong!', err);
                    });



                spotifyApi.getUserPlaylists(user_id)
                    .then(function(data) {
                        console.log('Retrieved playlists', data.body);
                    },function(err) {
                        console.log('Something went wrong!', err);
                    });


                // we can also pass the token to the browser to make requests from there
                res.redirect('/#' +
                    querystring.stringify({
                        access_token: access_token,
                        refresh_token: refresh_token
                    }));
            } else {

                res.cookie('error', 'Token invalid');
                res.redirect('/');

            }
        });
    }
});


/*
.get('/etage/:etagenum/chambre', function(req, res) {

    res.render('chambre', {etage: req.params.etagenum});
}).use(function(req, res, next){
    res.setHeader('Content-Type', 'text/html');
    res.status(404).send('Page introuvable !');
    
});
*/

var server = app.listen(8080);
