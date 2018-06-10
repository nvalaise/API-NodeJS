var express = require('express');
var querystring = require('querystring');
var ejs = require('ejs');
var SpotifyWebApi = require('spotify-web-api-node');
var randomstring = require("randomstring");
var cookieParser = require('cookie-parser');
var cors = require('cors');
var request = require('request');

const monk = require('monk');
const mongoURL = 'mongo:27017/EdSound';
const db = monk(mongoURL);

db.then(function() {
    console.log('Connected correctly to database');
});

var TrackCollection = db.get('track');

var AsyncLock = require('async-lock');

var lock_playlist = new AsyncLock();

var app_url = 'https://db3561f6.ngrok.io';

var app = express();

app.use(express.static(__dirname + '/public'))
    .use(cors())
    .use(cookieParser());

app.set('views', __dirname + '/views')
    .set('view engine', 'ejs');


/*
var facebook_client_id = '197391577565108',
    facebook_client_secret = '785de91ae300c8286b8013bcd943f847',
    facebook_redirect_uri = app_url + '/facebook/callback',
    facebook_fields = 'id email name user_likes',
    facebook_profile_url;
*/

var spotify_client_id = '6789cda33821496080d428075ff99d95',
    spotify_client_secret = '66ed346771fe492c9ed0323cd59d840a',
    spotify_redirect_uri = app_url + '/spotify/callback',
    spotify_scopes = 'user-library-read user-library-modify playlist-read-private playlist-modify-public playlist-modify-private playlist-read-collaborative user-read-recently-played user-top-read user-read-private user-read-email user-read-birthdate user-modify-playback-state user-read-currently-playing user-read-playback-state user-follow-modify user-follow-read',
    spotify_user_id = undefined,
    spotify_playlist = undefined;


var deezer_client_id = '282544',
    deezer_client_secret = '77584efad7ca58b4e2a9bcc0761e6fac',
    deezer_redirect_uri = app_url + '/deezer/callback',
    deezer_scopes = 'basic_access,email,manage_library',
    deezer_user_id = undefined,
    deezer_playlist = undefined;


var spotifyApi = new SpotifyWebApi({
    clientId: spotify_client_id,
    clientSecret: spotify_client_secret,
    redirectUri: spotify_redirect_uri
});


app.get('/', function(req, res) {

    var error = req.cookies['error'] || null;
    res.clearCookie('error');


    var spotify_exist = (spotify_user_id === undefined) ? false : true;
    var deezer_exist = (deezer_user_id === undefined) ? false : true;

    res.setHeader('Content-Type', 'text/html');
    res.render('home', {error : error, spotify: spotify_exist, deezer: deezer_exist});

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
                redirect_uri: spotify_redirect_uri,
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

                spotifyApi.getMe()
                    .then(function(data) {
                        spotify_user_id = data.body.id;
                        res.redirect('/');
                    }, function(err) {
                        console.log('Something went wrong!', err);
                        res.redirect('/');
                    });


                // we can also pass the token to the browser to make requests from there
            } else {

                res.cookie('error', 'Token invalid');
                res.redirect('/');

            }
        });
    }
});

app.get('/deezer/login', function(req, res) {

    var state = randomstring.generate(16);
    res.cookie('stateKey', state);

    // Requête pour autoriser l'utilisateur à utiliser Spotify sur cette application
    res.redirect('https://connect.deezer.com/oauth/auth.php?' +
        querystring.stringify({
            app_id: deezer_client_id,
            redirect_uri: deezer_redirect_uri,
            perms: deezer_scopes,
            state: state
        }));
});

app.get('/deezer/callback', function(req, res) {


    var error_reason = req.query.error_reason || null;
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies['stateKey'] : null;

    if (state === null || state !== storedState) { // impossible de récupérer le code d'autorisation passé en paramètre
        res.cookie('error', 'Code du status invalide');
        res.redirect('/');

    } else { // code l'autorisation récupéré !!!
        if (error_reason !== null) {
            res.cookie('error', 'Token invalid');
        } else if (code !== null) {
            res.clearCookie('stateKey');

            // Options de la requête pour récupérer le token
            var deezer_access_token_url = 'https://connect.deezer.com/oauth/access_token.php?app_id='+deezer_client_id +'&secret='+deezer_client_secret+'&code='+code+'&output=json';

            request.get(deezer_access_token_url, function(error, response, body) {
                if(!error && response.statusCode === 200) {

                    deezer_user_id = JSON.parse(body).access_token;

                } else {
                    res.cookie('error', 'Token invalid');
                }
                res.redirect('/');
            });
        }
    }
});


var promiseFindTrackFromSpotifyToDeezer = function(track) {
    return new Promise(function (resolve, reject){
        var compar = [];

        track.artists.forEach(function (elem) {
            compar.push(elem.name);
        });

        var req = {'deezer.title': track.name, 'deezer.artist.name' : { $in: compar }};

        try {
            TrackCollection.find(req).then(function (result) {
                resolve(result);
            });
        } catch (err) {
            reject(err);
        }
    });
};

var promiseFindTrackFromDeezerToSpotify = function(track) {
    return new Promise(function (resolve, reject){

        var req = {'spotify.name': track.title, 'spotify.artists.name' : {$in: [track.artist.name]}};

        try {
            TrackCollection.find(req).then(function (result) {
                resolve(result);
            });
        } catch (err) {
            reject(err);
        }
    });
};

var count = 0;
app.get('/playlists', function(req, res) {
    if (spotify_user_id !== undefined) {
        lock_playlist.acquire('key1', function(done) {
            spotifyApi.getUserPlaylists(spotify_user_id)
                .then(function(dataPlaylist) {
                    spotify_playlist = dataPlaylist.body.items;

                    spotify_playlist.forEach(function(playlist) {

                        spotifyApi.getPlaylistTracks(spotify_user_id, playlist.id).then(function(dataTrack) {

                            dataTrack.body.items.forEach(function (track) {
                                promiseFindTrackFromSpotifyToDeezer(track.track).then(function(result) {
                                    if (result.length === 0) {
                                        TrackCollection.findOne({'spotify.id': track.track.id}).then(function (result) {
                                            if (result === null) {
                                                TrackCollection.insert({"spotify": track.track}).then(function() {
                                                    console.log("1 track inserted (Spotify)");
                                                })
                                            } else {
                                                // Update
                                                console.log("Track found in dbo (Spotify)");
                                            }
                                        });
                                    } else if (result.length === 1) {
                                        TrackCollection.update({'_id': result[0]._id}, {"spotify": track.track, "deezer": result[0]}).then(function () {
                                            console.log("Liaison Spotify -> Deezer : found one matching track");

                                        });
                                    }
                                });
                            });
                        }, function(err) {
                            console.log('Something went wrong!', err);
                        })
                    });

                    done();

                },function(err) {
                    console.log('Something went wrong!', err);
                    done();
                });

        }, function(err, ret) {}, {});

    } else {
        lock_playlist.acquire('key1', function(done) {
            done();
        }, function(err, ret) {}, {});
    }

    if (deezer_user_id !== undefined) {
        lock_playlist.acquire('key1', function(done) {

            var deezer_url_playlist = 'https://api.deezer.com/user/me/playlists&access_token='+deezer_user_id;

            request.get(deezer_url_playlist, function(errorPlaylist, responsePlaylist, bodyPlaylist) {
                if (!errorPlaylist && responsePlaylist.statusCode === 200) {
                    deezer_playlist = JSON.parse(bodyPlaylist);

                    deezer_playlist.data.forEach(function(playlist) {
                        var deezer_url_tracks = playlist.tracklist+'&access_token='+deezer_user_id;
                        request.get(deezer_url_tracks, function(errorTrack, responseTrack, bodyTrack) {
                            JSON.parse(bodyTrack).data.forEach(function (track) {
                                promiseFindTrackFromDeezerToSpotify(track).then(function(result) {
                                    if (result.length === 0) {
                                        TrackCollection.findOne({ 'deezer.id': track.id }).then(function (result) {
                                            if (result === null) {
                                                TrackCollection.insert({"deezer": track}).then(function() {
                                                    console.log("1 track inserted (Deezer)");
                                                });
                                            } else {
                                                // Update
                                                console.log("Track found in dbo (Deezer)");
                                            }
                                        });
                                    } else if (result.length === 1) {
                                        TrackCollection.update({'_id': result[0]._id}, {"deezer": track, "spotify": result[0]}).then(function () {
                                            console.log("Liaison Deezer -> Spotify : found one matching track");
                                        });
                                    }
                                });
                            });
                        });
                    });
                }
                done();
            });
        }, function(err, ret) {}, {});

    } else {
        lock_playlist.acquire('key1', function(done) {
            done();
        }, function(err, ret) {}, {});
    }

    lock_playlist.acquire('key1', function(done) {
        res.json({spotify: spotify_playlist, deezer:deezer_playlist});

        done();
    }, function(err, ret) {}, {});
});


app.use(function(req, res, next){
    res.setHeader('Content-Type', 'text/html');
    res.status(404).send('Page introuvable !');
    
});


var server = app.listen(8080);
