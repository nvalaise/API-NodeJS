var express = require('express');
var querystring = require('querystring');
var ejs = require('ejs');
var SpotifyWebApi = require('spotify-web-api-node');
var randomstring = require("randomstring");
var cookieParser = require('cookie-parser');
var cors = require('cors');
var request = require('request');
var AsyncLock = require('async-lock');
const monk = require('monk');
const mongoURL = 'mongo:27017/EdSound';
const db = monk(mongoURL);

db.then(function() {
    console.log('Connected correctly to database');
});

var TrackCollection = db.get('track');

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


/*
 * return \Promise
 * ~spotify
 * Retourne les playlists créées par l'utilisateur
 */
function promiseFindSpotifyPlaylists () {
    return new Promise(function(resolve, reject) {

        if(spotify_user_id === undefined) {
            reject("spotify_user_id is undefined");
        } else {
            spotifyApi.getUserPlaylists(spotify_user_id).then(function(playlists) {
                resolve(playlists);
            },function(err) {
                reject(err);
            });
        }
    });
}


/*
 * return \Promise
 * ~spotify
 * Retourne les musiques des playlists de l'utilisateur
 * @param playlists array
 */
var promiseFindSpotifyPlaylistsTracks = function (playlists) {

    var tracks = [];
    var countSpotify = 0;

    return new Promise(function(resolve, reject) {
        playlists.body.items.forEach(function(playlist) {

            spotifyApi.getPlaylistTracks(spotify_user_id, playlist.id).then(function(playlistTracks) {

                var iTracks = 0;

                playlistTracks.body.items.forEach(function (track) {
                    tracks.push(track);
                    iTracks++;
                    if(iTracks === playlistTracks.body.items.length) {
                        countSpotify++;

                        if(countSpotify === playlists.body.items.length) {
                            console.log("promiseFindSpotifyPlaylistsTracks terminée")
                            resolve(tracks);
                        }
                    }
                });

                if (playlistTracks.body.items.length === 0)
                    countSpotify++;

            }, function(err) {
                reject(err);
            });
        });
    });
};

/*
 * return \Promise
 * ~spotify
 * Retourne les musiques sauvegardé par l'utilisateur
 */
function promiseFindSavedTracksSpotify () {

    return new Promise(function (resolve, reject) {

        if(spotify_user_id === undefined) {
            reject("spotify_user_id is undefined");
        } else {
            var tracks = [];

            var getMySavedTracksFnct = function(offset) {

                spotifyApi.getMySavedTracks({'limit' : 50, 'offset': offset}).then(function(savedTracks) {

                    savedTracks.body.items.forEach(function (item) {
                        tracks.push(item);
                    });

                    if(offset < savedTracks.body.total)
                        getMySavedTracksFnct(offset+50);
                    else {
                        resolve(tracks);
                    }

                }, function(err) {
                    console.log('Something went wrong!', err);
                    reject(err);
                });
            };

            getMySavedTracksFnct(0);
        }
    });
}

/*
 * return \Promise
 * ~spotify
 * Retourne le _id des tracks relevés dans la requête
 * @param tracks array
 */
var promiseManageSpotifyTracks = function (tracks) {
    return new Promise(function(resolve, reject) {
        var countSpotify = 0;
        var validate = 0;
        var quota = new AsyncLock();
        var lock = new AsyncLock(),
            items;

        tracks.forEach(function (track) {

            promiseFindTrackFromSpotifyToDeezer(track.track).then(function (result) {

                try {
                    if (result.length === 0) {
                        lock.acquire('key-promiseManageSpotifyTracks', function (done) {
                            var searchURL = 'https://api.deezer.com/search?q=', search;
                            if (track.track.artists === null)
                                search = 'track:"' + track.track.name + '"';
                            else
                                search = 'track:"' + track.track.name + '"artist:"' + track.track.artists[0].name + '"';

                            //console.log(searchURL + search);
                            quota.acquire('key-promiseManageSpotifyTracksQuota', function (handleQuota) {

                                request.get(searchURL + search, function (err, resp, body) {

                                    if (validate >= 50) {
                                        console.log("Pause");
                                        setTimeout(handleQuota, 5000);
                                    } else {
                                        validate++;
                                        handleQuota();
                                    }

                                    if (resp !== undefined && resp.statusCode === 200) {
                                        items = JSON.parse(body);
                                        if (items.error !== undefined && items.error.code === 4) {
                                            done("Deezer: Quota limit exceeded.Please wait 5s !", null);
                                        }
                                        if (items.data !== undefined && items.total !== undefined) {
                                            if (items.total === 1) {
                                                //console.log(body.data);
                                                done(null, items.data);
                                            } else {
                                                //console.log(items);
                                                done("Deezer: Too many results ("+ items.total + "). Treatments has to be more optimized", null);
                                            }
                                        } else {
                                            //console.log(items);
                                            done("Error during request rendering", null);
                                        }
                                    } else {
                                        //console.log(body);
                                        done("Error during request", null);
                                    }
                                });
                            }, function () {
                                validate = 0;
                            });
                        }, function (err, ret) {

                            if (err !== null) {
                                //console.log(err);
                            }

                            var insert;
                            if (ret === null) {
                                insert = {'spotify': track.track, 'name': track.track.name};
                            } else {
                                insert = {'spotify': track.track, 'deezer': ret, 'name': track.track.name}
                            }
                            TrackCollection.findOne({'spotify.id': track.track.id}).then(function (result) {
                                if (result === null) {
                                    TrackCollection.insert(insert).then(function (result) {
                                        tabTracksId.push(result._id);
                                        countSpotify++;
                                        console.log("1 track inserted (Spotify) - " + countSpotify + "/" + tracks.length);



                                        if (countSpotify === tracks.length) {
                                            resolve(tabTracksId);
                                        }
                                    })
                                } else {
                                    TrackCollection.update({'_id': result._id}, {$set: insert}).then(function () {
                                        tabTracksId.push(result._id);
                                        countSpotify++;
                                        console.log("1 track updated (Spotify) - " + countSpotify + "/" + tracks.length);
                                        if (countSpotify === tracks.length) {
                                            resolve(tabTracksId);
                                        }
                                    });
                                }
                            });
                        });
                    } else if (result.length === 1) {
                        TrackCollection.update({'_id': result[0]._id}, {
                            $set: {
                                'spotify': track.track,
                                'deezer': result[0],
                                'name': track.track.name
                            }
                        }).then(function () {
                            tabTracksId.push(result[0]._id);

                            countSpotify++;
                            console.log("Liaison Spotify -> Deezer : found one matching track - " + countSpotify + "/" + tracks.length);

                            if (countSpotify === tracks.length) {
                                resolve(tabTracksId);
                            }
                        });
                    }
                } catch (err) {
                    reject(err);
                }
            }).catch(function (err) {
                console.log(err);
            });
        });
    });
};

/*
 * return \Promise
 * ~deezer
 * Retourne les playlists créées par l'utilisateur
 */
function promiseFindDeezerPlaylists () {

    return new Promise(function(resolve, reject) {

        if(deezer_user_id === undefined) {
            reject("deezer_user_id is undefined");
        } else {
            var deezer_url_playlist = 'https://api.deezer.com/user/me/playlists&access_token='+deezer_user_id;

            try {
                request.get(deezer_url_playlist, function (err, resp, body) {

                    if (resp.statusCode === 200) {
                        resolve(JSON.parse(body));
                    } else {
                        reject(err);
                    }
                });
            } catch (err) {
                reject(err);
            }
        }
    });
}

/*
 * return \Promise
 * ~deezer
 * Retourne le _id des tracks relevés dans la requête
 * @param tracks array
 */
var promiseFindDeezerPlaylistsTracks = function (playlists) {

    var tracks = [];
    var countDeezer = 0;
    var deezer_url_tracks;

    return new Promise(function(resolve, reject) {
        playlists.data.forEach(function(playlist) {

            deezer_url_tracks = playlist.tracklist+'&access_token='+deezer_user_id;

            request.get(deezer_url_tracks, function(err, resp, body) {
                var iTracks = 0;
                var bodyJSON = JSON.parse(body);


                if (resp.statusCode === 200) {
                    bodyJSON.data.forEach(function (track) {
                        tracks.push(track);
                        iTracks++;

                        if (iTracks === bodyJSON.data.length) {
                            countDeezer++;

                            if(countDeezer === playlists.data.length) {
                                resolve(tracks);
                            }
                        }
                    });

                    if(bodyJSON.data.length === 0)
                        countDeezer++;

                } else {
                    reject(err);
                }
            });
        });
    });
};



// TODO
var promiseManageDeezerTracks = function (tracks) {

    var countDeezer = 0;
    var lock;

    return new Promise(function(resolve, reject) {
        tracks.forEach(function (track) {

            promiseFindTrackFromDeezerToSpotify(track).then(function (result) {
                try {
                    if (result.length === 0) {

                        lock = new AsyncLock();

                        lock.acquire('key-promiseManageDeezerTracks', function(done) {

                            if(spotify_user_id === undefined) {
                                done("You have to be registrer on Spotify", null);
                            } else {
                                var search;

                                if (track.artist.name === null)
                                    search = 'track:' + track.title;
                                else
                                    search = 'track:' + track.title + ' artist:' + track.artist.name;

                                console.log(search);
                                spotifyApi.searchTracks(search).then(function (searchResult) {
                                    if (searchResult.body.tracks.total === 1) {
                                        console.log("Spotify research succeed !");
                                        done(null, searchResult.body.tracks.items[0]);
                                    } else {
                                        done("Spotify: Too many results. Treatments has to be more optimized", null);
                                    }
                                }).catch(function(err) {
                                    console.log(err);
                                });
                            }

                        }, function(err, ret) {

                            if (err !== null) {
                                console.log(err);
                            }

                            var insert;
                            if (ret === null) {
                                insert = {'deezer': track, 'name': track.title}
                            } else {
                                insert = {'deezer': track, 'spotify': ret, 'name': track.title}
                            }

                            TrackCollection.findOne({'deezer.id': track.id}).then(function (result) {
                                if (result === null) {
                                    TrackCollection.insert(insert).then(function (result) {
                                        tabTracksId.push(result._id);
                                        //console.log("1 track inserted (Deezer)");

                                        countDeezer++;
                                        if (countDeezer === tracks.length) {
                                            resolve(tabTracksId);
                                        }
                                    })
                                } else {
                                    TrackCollection.update({'_id': result._id}, {$set: insert}).then(function () {
                                        tabTracksId.push(result._id);
                                        //console.log("Track found in dbo (Deezer)");

                                        countDeezer++;
                                        if (countDeezer === tracks.length) {
                                            resolve(tabTracksId);
                                        }
                                    });
                                }
                            });

                        });

                    } else if (result.length === 1) {
                        TrackCollection.update({'_id': result[0]._id}, {$set: {'deezer': track, 'name': track.title}}).then(function () {
                            tabTracksId.push(result[0]._id);
                            console.log("Liaison Deezer -> Spotify : found one matching track");

                            countDeezer++;
                            if (countDeezer === tracks.length) {
                                resolve(tabTracksId);
                            }
                        });
                    }
                } catch (err) {
                    reject(err);
                }
            }).catch(function(err) {
                console.log(err);
            });
        });
    });
};

/*
 * return \Promise
 * ~spotify -> ~deezer
 * Cherche une musique deezer dans la bdd
 * @param track SpotifyJSON
 */
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

/*
 * return \Promise
 * ~deezer -> ~spotify
 * Cherche une musique spotify dans la bdd
 * @param track DeezerJSON
 */
var promiseFindTrackFromDeezerToSpotify = function(track) {
    return new Promise(function (resolve, reject) {

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


var tabTracksId;

app.get('/playlists', function(req, res) {

    tabTracksId = [];

    Promise.all([

        // Lookup over Spotify playlists
        /*promiseFindSpotifyPlaylists()
            .then( function (playlists) { return promiseFindSpotifyPlaylistsTracks(playlists)
                .then(function (tracks) { return promiseManageSpotifyTracks(tracks)
                    .then(function (result) {
                        console.log(result.length);
                        console.log("promiseManageSpotifyTracks callback");
                    }).catch(function(err) {
                        console.log(err);
                    })
                })
            }).catch(function(err) {
                console.log(err);
            }),*/

        promiseFindDeezerPlaylists()
            .then(function (playlists) { return promiseFindDeezerPlaylistsTracks(playlists)
                .then(function(tracks) { return promiseManageDeezerTracks(tracks)
                    .then(function (result) {
                        console.log(result.length);
                        console.log("promiseManageDeezerTracks callback");
                    })
                }).catch(function(err) {
                    console.log(err);
                })
            }).catch(function(err) {
                console.log(err);
            }),

        // Lookup over Spotify saved tracks
        promiseFindSavedTracksSpotify()
            .then(function(tracks) { return promiseManageSpotifyTracks(tracks)
                .then(function (result) {
                    console.log(result.length);
                    console.log("promiseFindSavedTracksSpotify callback");
                }).catch(function(err) {
                    console.log(err);
                })
            }).catch(function(err) {
                console.log(err);
            })

    ]).then(function (result) {
        console.log("child callback");

        TrackCollection.find({'_id': {$in: tabTracksId}}, {'_id': 1, 'name': 1, 'spotify.preview_url': 1 ,'deezer.preview': 1 }).then(function (result) {

            console.log("You can see your datas");
            res.json(result);

        });

        //res.json(tabTracksId);
    }).catch(function (err) {
        console.log(err);
        res.setHeader('Content-Type', 'text/html');
        res.status(500).send('Something went wrong...');
    });

    /*
    try {
        TrackCollection.distinct('_id', {'_id': {$in: tabTracksId}}).then(function (result) {

            console.log("You can see your datas");

            res.json(result);

        });
    } catch (err) {
        console.log(err);

        res.setHeader('Content-Type', 'text/html');
        res.status(500).send('Something went wrong...');

    }*/

});


app.use(function(req, res, next){
    res.setHeader('Content-Type', 'text/html');
    res.status(404).send('Page introuvable !');
    
});


var server = app.listen(8080);
