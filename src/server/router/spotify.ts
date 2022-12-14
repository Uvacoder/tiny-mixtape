import { Prisma } from "@prisma/client";
import * as trpc from "@trpc/server";
import { z } from "zod";

import { INITIAL_AUDIO_FEATURES } from "../../components/new-playlist/new-playlist-state";
import { range } from "../../utils/array";
import { calculateAverageAudioFeatures } from "../../utils/audio-features";
import { sequentialFetch } from "../../utils/fetch";
import { PlaylistTracksSchema } from "./output-types";
import { createSpotifyRouter } from "./spotify-router";
import { TRPC_ERROR_CODE_KEY_BY_HTTP_STATUS } from "./trpc-utils";

const API_BASE_URL = "https://api.spotify.com/v1";

export const spotifyRouter = createSpotifyRouter()
  .query("search", {
    input: z.object({
      q: z.string(),
      offset: z.number().min(0).max(1000),
      limit: z.number().min(0).max(50),
    }),
    output: PlaylistTracksSchema,
    async resolve({ ctx, input }) {
      let url = `${API_BASE_URL}/search?${new URLSearchParams({
        q: input.q,
        type: "track",
        offset: `${input.offset}`,
        limit: `${input.limit}`,
      })}`;
      if (!input.q.trim()) {
        return [];
      }
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${ctx.session.accessToken}`,
        },
      }).then((res) => res.json());

      if (res.error) {
        throw new trpc.TRPCError({
          code:
            TRPC_ERROR_CODE_KEY_BY_HTTP_STATUS.get(res.error.status) ??
            "INTERNAL_SERVER_ERROR",
          message: `${res.error.status}! ${res.error.message}`,
        });
      }

      if (res.tracks.items.length === 0) {
        throw new trpc.TRPCError({
          code: "NOT_FOUND",
          message: "No tracks found",
        });
      }

      return res.tracks.items.map((item: any) => {
        return {
          id: item.id,
          uri: item.uri,
          name: item.name,
          artists: item.artists.map((artist: any) => artist.name),
          previewUrl: item.preview_url,
          albumName: item.album.name,
          image: item.album.images.at(-1),
          duration: item.duration_ms,
        };
      });
    },
  })
  .query("getRecommendations", {
    input: z.object({
      trackSeeds: z.array(z.string()).max(5),
      limit: z.number().min(1).max(100),
      danceability: z.number().min(0).max(100).optional(),
      tempo: z.number().optional(),
      valence: z.number().min(0).max(100).optional(),
      energy: z.number().min(0).max(100).optional(),
    }),
    output: PlaylistTracksSchema,
    async resolve({ ctx, input }) {
      if (input.trackSeeds.length === 0) {
        return [];
      }

      const searchParams = new URLSearchParams({
        seed_tracks: input.trackSeeds.join(","),
        limit: `${input.limit}`,
      });
      if (input.danceability !== undefined) {
        searchParams.append(
          "target_danceability",
          `${input.danceability / 100}`
        );
      }
      if (input.tempo !== undefined) {
        searchParams.append("target_tempo", `${input.tempo}`);
      }
      if (input.valence !== undefined) {
        searchParams.append("target_valence", `${input.valence / 100}`);
      }
      if (input.energy !== undefined) {
        searchParams.append("target_energy", `${input.energy / 100}`);
      }

      const res = await fetch(
        `${API_BASE_URL}/recommendations?${searchParams}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${ctx.session.accessToken}`,
          },
        }
      ).then((res) => res.json());

      if (res.error) {
        throw new trpc.TRPCError({
          code:
            TRPC_ERROR_CODE_KEY_BY_HTTP_STATUS.get(res.error.status) ??
            "INTERNAL_SERVER_ERROR",
          message: `${res.error.status}! ${res.error.message}`,
        });
      }

      //get audio features of each track
      const audioFeaturesRes = await fetch(
        `${API_BASE_URL}/audio-features?${new URLSearchParams({
          ids: res.tracks.map((track: any) => track.id).join(","),
        })}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${ctx.session.accessToken}`,
          },
        }
      ).then((res) => res.json());
      const hasAudioFeatures = !audioFeaturesRes.error;

      return res.tracks.map((track: any, i: number) => {
        const audioFeatures = hasAudioFeatures
          ? {
              danceability: Math.floor(
                audioFeaturesRes.audio_features[i].danceability * 100
              ),
              tempo: audioFeaturesRes.audio_features[i].tempo,
              valence: Math.floor(
                audioFeaturesRes.audio_features[i].valence * 100
              ),
              energy: Math.floor(
                audioFeaturesRes.audio_features[i].energy * 100
              ),
            }
          : INITIAL_AUDIO_FEATURES;
        return {
          id: track.id,
          uri: track.uri,
          name: track.name,
          previewUrl: track.preview_url,
          artists: track.artists.map((artist: any) => artist.name),
          albumName: track.album.name,
          image: track.album.images.at(-1),
          duration: track.duration_ms,
          ...audioFeatures,
        };
      });
    },
  })
  .query("getPlaylists", {
    input: z.object({
      limit: z.number().min(1).max(100).nullish(),
      cursor: z.string().nullish(),
      isCreatorOnly: z.boolean(),
    }),
    output: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          image: z.object({
            url: z.string(),
            height: z.number(),
            width: z.number(),
          }),
          uri: z.string(),
          audioFeatures: z.object({
            danceability: z.number(),
            energy: z.number(),
            tempo: z.number(),
            valence: z.number(),
          }),
        })
      ),
      total: z.number(),
      nextCursor: z.string().optional(),
    }),
    async resolve({ ctx, input }) {
      const limit = input.limit ?? 50;
      const { cursor } = input;
      const [total, items] = await Promise.all([
        ctx.prisma.playlist.count({
          where: input.isCreatorOnly
            ? { createdBy: { equals: ctx.session.user.id } }
            : undefined,
        }),
        ctx.prisma.playlist.findMany({
          take: limit + 1,
          cursor: input.cursor
            ? {
                id: input.cursor,
              }
            : undefined,
          orderBy: {
            createdAt: "desc",
          },
          where: input.isCreatorOnly
            ? { createdBy: { equals: ctx.session.user.id } }
            : undefined,
        }),
      ]);
      let nextCursor: typeof cursor | undefined = undefined;
      if (items.length > limit) {
        const nextItem = items.pop();
        nextCursor = nextItem!.id;
      }

      const spotifyPlaylists: any[] = await Promise.all(
        items.map((playlist) =>
          fetch(`${API_BASE_URL}/playlists/${playlist.spotifyId}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${ctx.session.accessToken}`,
            },
          }).then((res) => res.json())
        )
      );

      const MAX_ITEMS_PER_REQUEST = 100;
      //list of list of {audio_feautures: [{energy, etc}]}
      const audioFeatures: any[][] = await Promise.all(
        spotifyPlaylists.map((playlist) => {
          const indices = range(
            0,
            playlist.tracks.items.length - 1,
            MAX_ITEMS_PER_REQUEST
          );
          const configs = indices.map((index) => {
            return {
              url: `${API_BASE_URL}/audio-features?${new URLSearchParams({
                ids: playlist.tracks.items
                  .slice(index, index + MAX_ITEMS_PER_REQUEST)
                  .map((item: any) => item.track.id)
                  .join(","),
              })}`,
              init: {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${ctx.session.accessToken}`,
                },
              },
            };
          });
          return sequentialFetch(configs);
        })
      );

      const averageAudioFeatures = audioFeatures.map(
        (audioFeaturesForPlaylist: any[]) => {
          const audioFeaturesForTracksOfPlaylist = audioFeaturesForPlaylist
            .map((af) => af.audio_features ?? INITIAL_AUDIO_FEATURES)
            .flat();
          return calculateAverageAudioFeatures(
            audioFeaturesForTracksOfPlaylist.map((track) => {
              return {
                danceability: track.danceability * 100,
                energy: track.energy * 100,
                tempo: track.tempo,
                valence: track.valence * 100,
              };
            })
          );
        }
      );

      const playlists: any[] = spotifyPlaylists.map((playlist, i) => {
        return {
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          image: playlist.images[1],
          uri: `https://open.spotify.com/playlist/${playlist.id}`,
          audioFeatures: averageAudioFeatures[i],
        };
      });
      return {
        items: playlists,
        total,
        nextCursor,
      };
    },
  })
  .mutation("createPlaylist", {
    input: z.object({
      uris: z.array(z.string()).min(1),
      name: z.string(),
      isPublic: z.boolean(),
      description: z.string(),
    }),
    output: z.object({
      name: z.string(),
      url: z.string(),
    }),
    async resolve({ ctx, input }) {
      const createPlaylistRes = await fetch(
        `${API_BASE_URL}/users/${ctx.session.user.id}/playlists`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: input.name,
            public: input.isPublic,
            description: input.description,
          }),
        }
      ).then((res) => res.json());
      if (createPlaylistRes.error) {
        throw new trpc.TRPCError({
          code:
            TRPC_ERROR_CODE_KEY_BY_HTTP_STATUS.get(
              createPlaylistRes.error.status
            ) ?? "INTERNAL_SERVER_ERROR",
          message: `${createPlaylistRes.error.status}! ${createPlaylistRes.error.message}`,
        });
      }

      const playlistId = createPlaylistRes.id;
      const playlistUrl = `https://open.spotify.com/playlist/${playlistId}`;

      const MAX_ITEMS_PER_REQUEST = 100;
      const positions = range(0, input.uris.length - 1, MAX_ITEMS_PER_REQUEST);
      const configs = positions.map((position) => {
        return {
          url: `${API_BASE_URL}/playlists/${playlistId}/tracks`,
          init: {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ctx.session.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              position,
              uris: input.uris.slice(
                position,
                position + MAX_ITEMS_PER_REQUEST
              ),
            }),
          },
        };
      });
      const addTracksToPlaylistJson = await sequentialFetch(configs);
      const addTracksToPlaylistErrors = addTracksToPlaylistJson.filter(
        (json) => json.error
      );
      if (addTracksToPlaylistErrors.length > 0) {
        throw new trpc.TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Some tracks were not added to the playlist on Spotify. Visit ${playlistUrl} to manually add the tracks.`,
          cause: new AggregateError(
            addTracksToPlaylistErrors.map(
              (json) => new Error(`${json.error.status}! ${json.error.message}`)
            )
          ),
        });
      }

      try {
        await ctx.prisma.playlist.create({
          data: {
            spotifyId: playlistId,
            createdBy: ctx.session.user.id,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
          throw new trpc.TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Unable to save playlist ${input.name} to the database, but the it's available at ${playlistUrl}.`,
            cause: e,
          });
        }
      }

      return {
        name: input.name,
        url: playlistUrl,
      };
    },
  });
