import _ from 'lodash';

import Dispatcher from '../dispatcher/AppDispatcher';
import Constants from '../constants/Constants';

import SonosService from '../services/SonosService';
import MusicServiceClient from '../services/MusicServiceClient';

import BrowserListStore from '../stores/BrowserListStore';

export default {
    _getItem(item) {
        if (!item.serviceClient) {
            return Promise.resolve(item);
        }

        const client = item.serviceClient;
        const serviceType = client._serviceDefinition.ServiceIDEncoded;

        const settingsMatch = _.find(SonosService._accountInfo, {
            Type: String(serviceType)
        });

        if (settingsMatch) {
            const uri = client.getTrackURI(
                item.id,
                client._serviceDefinition.Id,
                settingsMatch.SerialNum
            );
            const token = client.getServiceString(
                serviceType,
                settingsMatch.Username
            );
            const meta = client.encodeItemMetadata(uri, item, token);

            return Promise.resolve({
                uri: _.escape(uri),
                metadata: meta
            });
        }

        return client.getMediaURI(item.id).then(uri => {
            return {
                uri: _.escape(uri),
                metadata: client.encodeItemMetadata(uri, item)
            };
        });
    },

    back() {
        Dispatcher.dispatch({
            actionType: Constants.BROWSER_BACK
        });
    },

    home() {
        Dispatcher.dispatch({
            actionType: Constants.BROWSER_HOME
        });
    },

    more(state) {
        const sonos = SonosService._currentDevice;
        const params = {
            start: state.items.length
        };

        if (state.items.length >= state.total) {
            return;
        }

        const client = state.serviceClient;

        if (client && state.total > state.items.length) {
            client
                .getMetadata(
                    state.parent.id,
                    state.items.length,
                    state.items.length + 100
                )
                .then(res => {
                    const items = [];

                    if (res.mediaMetadata) {
                        if (!_.isArray(res.mediaMetadata)) {
                            res.mediaMetadata = [res.mediaMetadata];
                        }

                        res.mediaMetadata.forEach(i => {
                            i.serviceClient = client;
                            items[i.$$position] = i;
                        });
                    }

                    if (res.mediaCollection) {
                        if (!_.isArray(res.mediaCollection)) {
                            res.mediaCollection = [res.mediaCollection];
                        }

                        res.mediaCollection.forEach(i => {
                            i.serviceClient = client;
                            items[i.$$position] = i;
                        });
                    }

                    state.items = state.items.concat(items);
                    state.total = res.total || state.total;

                    Dispatcher.dispatch({
                        actionType: Constants.BROWSER_SCROLL_RESULT,
                        state: state
                    });
                });
        } else if (state.search) {
            sonos.searchMusicLibrary(
                state.type,
                state.term,
                params,
                (err, result) => {
                    if (err || !result || !result.items) {
                        return;
                    }

                    state.items = state.items.concat(result.items);

                    Dispatcher.dispatch({
                        actionType: Constants.BROWSER_SEARCH_SCROLL_RESULT,
                        state: state
                    });
                }
            );
        } else {
            sonos.getMusicLibrary(
                state.id || state.searchType,
                params,
                (err, result) => {
                    if (err || !result || !result.items) {
                        return;
                    }

                    state.items = state.items.concat(result.items);

                    Dispatcher.dispatch({
                        actionType: Constants.BROWSER_SCROLL_RESULT,
                        state: state
                    });
                }
            );
        }
    },

    playNow(eventTarget) {
        this._getItem(eventTarget).then(item => {
            const sonos = SonosService._currentDevice;

            if (
                item.metadata &&
                item.metadataRaw &&
                item.metadata.class === 'object.item.audioItem.audioBroadcast'
            ) {
                sonos.play(
                    {
                        uri: item.uri,
                        metadata: item.metadataRaw
                    },
                    () => {
                        SonosService.queryState(sonos);
                    }
                );
            } else if (item.class && item.class === 'object.item.audioItem') {
                sonos.play(item.uri, () => {
                    SonosService.queryState(sonos);
                });
            } else {
                sonos.getMusicLibrary('queue', { total: 0 }, (err, res) => {
                    if (err) {
                        return;
                    }

                    let pos = 1;
                    if (res.total) {
                        pos = Number(res.total) + 1;
                    }
                    sonos.queue(item, () => {
                        sonos.goto(pos, () => {
                            sonos.play(() => {
                                SonosService.queryState(sonos);
                            });
                        });
                    });
                });
            }
        });
    },

    playNext(eventTarget) {
        this._getItem(eventTarget).then(item => {
            const sonos = SonosService._currentDevice;

            sonos.getPositionInfo((err, info) => {
                const pos = Number(info.Track) + 1;
                sonos.queue(item, pos, () => {
                    SonosService.queryState(sonos);
                });
            });
        });
    },

    addQueue(eventTarget) {
        this._getItem(eventTarget).then(item => {
            const sonos = SonosService._currentDevice;

            sonos.queue(item, () => {
                SonosService.queryState(sonos);
            });
        });
    },

    replaceQueue(eventTarget) {
        this._getItem(eventTarget).then(item => {
            const sonos = SonosService._currentDevice;

            sonos.flush(() => {
                sonos.queue(item, () => {
                    sonos.play(() => {
                        SonosService.queryState(sonos);
                    });
                });
            });
        });
    },

    removeService(service) {
        SonosService.removeMusicService(service.service);
    },

    _fetchLineIns() {
        const promises = [];

        Object.keys(SonosService._deviceSearches).forEach(host => {
            promises.push(
                new Promise(resolve => {
                    const sonos = SonosService._deviceSearches[host];

                    sonos.getMusicLibrary('AI:', {}, (err, result) => {
                        const items =
                            result && result.items ? result.items : [];

                        if (items.length === 0) {
                            resolve(items);
                            return;
                        }

                        sonos.getZoneAttrs((err1, data) => {
                            items.forEach(i => {
                                i.title = i.title + ': ' + data.CurrentZoneName;
                            });
                            resolve(items);
                        });
                    });
                })
            );
        });

        return Promise.all(promises).then(arr => {
            return _.flatten(arr);
        });
    },

    _fetchMusicServices() {
        const sonos = SonosService._currentDevice;
        const existingIds = SonosService._musicServices.map(s => s.service.Id);

        const promise = new Promise(resolve => {
            sonos.getAvailableServices((err, data) => {
                data = _.reject(data, item => {
                    return _.includes(existingIds, item.Id);
                });

                data = _.orderBy(data, 'Name');

                resolve(
                    data.map(out => {
                        return {
                            action: 'addService',
                            title: out.Name,
                            id: Number(out.Id),
                            data: out
                        };
                    })
                );
            });
        });

        return promise;
    },

    select(item) {
        const sonos = SonosService._currentDevice;
        let prendinBrowserUpdate;
        let objectId = item.searchType;

        if (item.action && item.action === 'library') {
            Dispatcher.dispatch({
                actionType: Constants.BROWSER_SELECT_ITEM,
                state: BrowserListStore.LIBRARY_STATE
            });
            return;
        }

        if (item.action && item.action === 'linein') {
            this._fetchLineIns().then(results => {
                const state = _.cloneDeep(item);
                state.items = results || [];

                Dispatcher.dispatch({
                    actionType: Constants.BROWSER_SELECT_ITEM,
                    state: state
                });
            });
            return;
        }

        if (item.action && item.action === 'browseServices') {
            this._fetchMusicServices().then(results => {
                const state = _.cloneDeep(item);
                state.items = results || [];

                Dispatcher.dispatch({
                    actionType: Constants.BROWSER_SELECT_ITEM,
                    state: state
                });
            });
            return;
        }

        if (item.action && item.action === 'addService') {
            Dispatcher.dispatch({
                actionType: Constants.BROWSER_ADD_MUSICSERVICE,
                service: new MusicServiceClient(item.data)
            });
            return;
        }

        if (item.action && item.action === 'service') {
            const client = new MusicServiceClient(item.service.service);
            client.setAuthToken(item.service.authToken.authToken);
            client.setKey(item.service.authToken.privateKey);

            client.getMetadata('root', 0, 100).then(res => {
                const state = {
                    title: client.name,
                    serviceClient: client,
                    items: res.mediaCollection.map(i => {
                        i.serviceClient = client;
                        return i;
                    })
                };

                Dispatcher.dispatch({
                    actionType: Constants.BROWSER_SELECT_ITEM,
                    state: state
                });
            });
            return;
        }

        if (item.serviceClient && item.itemType !== 'track') {
            const client = item.serviceClient;

            client.getMetadata(item.id, 0, 100).then(res => {
                const items = [];

                if (res.mediaMetadata) {
                    if (!_.isArray(res.mediaMetadata)) {
                        res.mediaMetadata = [res.mediaMetadata];
                    }

                    res.mediaMetadata.forEach(i => {
                        i.serviceClient = client;
                        items[i.$$position] = i;
                    });
                }

                if (res.mediaCollection) {
                    if (!_.isArray(res.mediaCollection)) {
                        res.mediaCollection = [res.mediaCollection];
                    }

                    res.mediaCollection.forEach(i => {
                        i.serviceClient = client;
                        items[i.$$position] = i;
                    });
                }

                const state = {
                    title: item.title,
                    parent: item,
                    serviceClient: client,
                    total: res.total,
                    items: _.without(items, undefined)
                };

                Dispatcher.dispatch({
                    actionType: Constants.BROWSER_SELECT_ITEM,
                    state: state
                });
            });

            return;
        }

        if (item.searchType) {
            prendinBrowserUpdate = {
                title: item.title,
                searchType: item.searchType
            };
        } else {
            prendinBrowserUpdate = item;
        }

        if (item.class) {
            objectId = item.id ? item.id : item.uri.split('#')[1];
        }

        sonos.getMusicLibrary(objectId, {}, (err, result) => {
            const state = prendinBrowserUpdate;
            state.items = result.items;

            Dispatcher.dispatch({
                actionType: Constants.BROWSER_SELECT_ITEM,
                state: state
            });
        });
    },

    changeSearchMode(mode) {
        Dispatcher.dispatch({
            actionType: Constants.BROWSER_CHANGE_SEARCH_MODE,
            mode: mode
        });
    }
};
