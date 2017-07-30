import _ from 'lodash';
import { handleActions } from 'redux-actions';
import Constants from '../constants';

const initialState = {
    currentGroup: null,
    currentHost: null,
    zones: [],
    deviceSearches: {},
    currentTracks: {},
    nextTracks: {},
    positionInfos: {},
    playStates: {},
    playModes: {},
    crossFadeModes: {}
};

export const REG = /^http:\/\/([\d\.]+)/;

function topologyReducer(state, action) {
    const zones = _(action.payload)
        .map(z => {
            const matches = REG.exec(z.location);
            z.host = matches[1];
            return z;
        })
        .groupBy('name')
        .map(g => {
            // TODO: what happens when a sub is added?
            if (g.length === 2) {
                g[0].name = g[0].name + ' (L + R)';
            }
            return _.find(g, { coordinator: 'true' }) || g[0];
        })
        .filter(z => {
            return _.includes(_.keys(state.deviceSearches), z.host);
        })
        .reject(z => z.name.toLocaleLowerCase().match('bridge'))
        .reject(z => z.name.toLocaleLowerCase().match('boost'))
        .value();

    console.log('topologyReducer', zones);
    return {
        ...state,
        zones
    };
}

function zoneGroupSelectReducer(state, action) {
    return {
        ...state,
        currentHost: action.payload.host,
        currentGroup: action.payload.group
    };
}

export default handleActions(
    {
        [Constants.SONOS_SERVICE_TOPOLOGY_EVENT]: topologyReducer,
        [Constants.SONOS_SERVICE_TOPOLOGY_UPDATE]: topologyReducer,

        [Constants.SONOS_SERVICE_ZONEGROUPS_DEFAULT]: zoneGroupSelectReducer,
        [Constants.ZONE_GROUP_SELECT]: zoneGroupSelectReducer,

        [Constants.SONOS_SERVICE_DEVICE_SEARCH_RESULT]: (state, action) => {
            return {
                ...state,
                deviceSearches: {
                    ...state.deviceSearches,
                    [action.payload.host]: action.payload
                }
            };
        },

        [Constants.SONOS_SERVICE_ZONEGROUP_TRACK_UPDATE]: (state, action) => {
            const { host, avTransportMeta, track, playState } = action.payload;
            const isPlaying =
                playState === 'transitioning'
                    ? state.currentTracks[host].isPlaying
                    : playState === 'playing';

            let trackInfo = track;

            if (trackInfo.class === 'object.item' && !avTransportMeta) {
                // skip because it's radio with no meta, so garbage
                return {
                    ...state
                };
            }

            if (trackInfo.class === 'object.item' && avTransportMeta) {
                trackInfo = {
                    title: avTransportMeta.title,
                    albumArtURI: track.albumArtURI
                };
            }

            return {
                ...state,
                currentTracks: {
                    ...state.currentTracks,
                    [host]: {
                        host,
                        isPlaying,
                        trackInfo
                    }
                }
            };
        },

        [Constants.SONOS_SERVICE_NEXT_TRACK_UPDATE]: (state, action) => {
            const { track, host } = action.payload;

            return {
                ...state,
                nextTracks: {
                    ...state.nextTracks,
                    [host]: track
                }
            };
        },

        [Constants.SONOS_SERVICE_QUEUE_UPDATE]: state => state,
        [Constants.SONOS_SERVICE_VOLUME_UPDATE]: state => state,

        [Constants.SONOS_SERVICE_PLAYSTATE_UPDATE]: (state, action) => {
            const { host, playState } = action.payload;

            if (playState === 'transitioning') {
                return {
                    ...state
                };
            }

            const isPlaying = playState === 'playing';

            return {
                ...state,
                currentTracks: {
                    ...state.currentTracks,
                    [host]: {
                        ...state.currentTracks[host],
                        isPlaying
                    }
                }
            };
        },

        [Constants.SONOS_SERVICE_POSITION_INFO_UPDATE]: (state, action) => {
            const { host, info } = action.payload;

            return {
                ...state,
                positionInfos: {
                    ...state.positionInfos,
                    [host]: info
                }
            };
        },

        [Constants.SONOS_SERVICE_CURRENT_CROSSFADE_MODE_UPDATE]: (
            state,
            action
        ) => {
            const { host, mode } = action.payload;

            return {
                ...state,
                crossFadeModes: {
                    ...state.crossFadeModes,
                    [host]: mode
                }
            };
        },

        [Constants.SONOS_SERVICE_CURRENT_PLAY_MODE_UPDATE]: (state, action) => {
            const { host, mode } = action.payload;

            return {
                ...state,
                playModes: {
                    ...state.playModes,
                    [host]: mode
                }
            };
        },

        [Constants.SONOS_SERVICE_MUSICSERVICES_UPDATE]: (state, action) => {
            console.log(action.payload);
            return state;
        }
    },
    initialState
);