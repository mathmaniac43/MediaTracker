import _ from 'lodash';

import { MediaItemBase, MediaItemDetailsResponse } from 'src/entity/mediaItem';
import { TvEpisode, TvEpisodeFilters } from 'src/entity/tvepisode';
import { UserRating, UserRatingFilters } from 'src/entity/userRating';
import { TvSeason } from 'src/entity/tvseason';
import { Seen, SeenFilters } from 'src/entity/seen';
import { knex } from 'src/dbconfig';
import { Watchlist } from 'src/entity/watchlist';
import { Image } from 'src/entity/image';

export const getDetailsKnex = async (params: {
  mediaItemId: number;
  userId: number;
}): Promise<MediaItemDetailsResponse> => {
  const { mediaItemId, userId } = params;

  const {
    mediaItem,
    seasons,
    episodes,
    seenHistory,
    userRating,
    watchlist,
    images,
    progress,
  } = await knex.transaction(async (trx) => {
    const mediaItem = await trx<MediaItemBase>('mediaItem')
      .where({
        id: mediaItemId,
      })
      .first();

    const seasons = await trx<TvSeason>('season')
      .where({
        tvShowId: mediaItemId,
      })
      .orderBy('seasonNumber', 'asc');

    const episodes = await trx<TvEpisode>('episode')
      .where({
        tvShowId: mediaItemId,
      })
      .orderBy('seasonNumber', 'asc')
      .orderBy('episodeNumber', 'asc');

    const seenHistory = await trx<Seen>('seen')
      .where({
        mediaItemId: mediaItemId,
        userId: userId,
        type: 'seen',
      })
      .orderBy('date', 'desc');

    const userRating = await trx<UserRating>('userRating')
      .where({
        mediaItemId: mediaItemId,
        userId: userId,
      })
      .orderBy('date', 'desc');

    const watchlist = await trx<Watchlist>('watchlist')
      .where({
        mediaItemId: mediaItemId,
        userId: userId,
      })
      .first();

    const images = await trx<Image>('image').where({
      mediaItemId: mediaItemId,
    });

    const progress = await trx<Seen>('seen').where({
      mediaItemId: mediaItemId,
      episodeId: null,
      userId: userId,
      type: 'progress',
    });

    return {
      mediaItem,
      seasons,
      episodes,
      seenHistory,
      userRating,
      watchlist,
      images,
      progress,
    };
  });

  if (!mediaItem) {
    return;
  }

  const groupedSeasonRating = _(userRating)
    .filter(UserRatingFilters.seasonUserRating)
    .groupBy((rating) => rating.seasonId)
    .mapValues((ratings) => (ratings?.length > 0 ? ratings[0] : null))
    .value();

  const groupedEpisodesRating = _(userRating)
    .filter(UserRatingFilters.episodeUserRating)
    .groupBy((rating) => rating.episodeId)
    .mapValues((ratings) => (ratings?.length > 0 ? ratings[0] : null))
    .value();

  const groupedEpisodesSeenHistory = _(seenHistory)
    .filter(SeenFilters.episodeSeenValue)
    .groupBy((seen) => seen.episodeId)
    .value();

  episodes.forEach((episode) => {
    episode.userRating = groupedEpisodesRating[episode.id];
    episode.seenHistory = groupedEpisodesSeenHistory[episode.id];
    episode.isSpecialEpisode = Boolean(episode.isSpecialEpisode);
    episode.lastSeenAt = _.first(episode.seenHistory)?.date;
    episode.seen = episode.seenHistory?.length > 0;
    delete episode.seasonAndEpisodeNumber;
  });

  const groupedEpisodes = _.groupBy(episodes, (episode) => episode.seasonId);
  const seasonPosters = _.keyBy(
    images.filter((image) => image.seasonId),
    (image) => image.seasonId
  );

  seasons.forEach((season) => {
    const hasPoster = Boolean(season.poster) && seasonPosters[season.id];

    season.isSpecialSeason = Boolean(season.isSpecialSeason);
    season.poster = hasPoster ? `/img/${seasonPosters[season.id].id}` : null;
    season.posterSmall = hasPoster
      ? `/img/${seasonPosters[season.id].id}?size=small`
      : null;
    season.episodes = groupedEpisodes[season.id] || [];
    season.userRating = groupedSeasonRating[season.id];
    season.seen =
      season.episodes
        ?.filter(TvEpisodeFilters.withReleaseDateEpisodes)
        .filter(TvEpisodeFilters.releasedEpisodes).length > 0 &&
      season.episodes
        ?.filter(TvEpisodeFilters.withReleaseDateEpisodes)
        .filter(TvEpisodeFilters.releasedEpisodes)
        .filter(TvEpisodeFilters.unwatchedEpisodes).length === 0;
  });

  const firstUnwatchedEpisode = _(episodes)
    .filter(TvEpisodeFilters.unwatchedEpisodes)
    .filter(TvEpisodeFilters.releasedEpisodes)
    .filter(TvEpisodeFilters.nonSpecialEpisodes)
    .minBy((episode) => episode.seasonNumber * 1000 + episode.episodeNumber);

  const upcomingEpisode = _(episodes)
    .filter(TvEpisodeFilters.withReleaseDateEpisodes)
    .filter(TvEpisodeFilters.nonSpecialEpisodes)
    .filter(TvEpisodeFilters.unreleasedEpisodes)
    .minBy((episode) => new Date(episode.releaseDate).getTime());

  const lastAiredEpisode = _(episodes)
    .filter(TvEpisodeFilters.withReleaseDateEpisodes)
    .filter(TvEpisodeFilters.nonSpecialEpisodes)
    .filter(TvEpisodeFilters.releasedEpisodes)
    .maxBy((episode) => new Date(episode.releaseDate).getTime());

  const unseenEpisodesCount = _(episodes)
    .filter(TvEpisodeFilters.nonSpecialEpisodes)
    .filter(TvEpisodeFilters.withReleaseDateEpisodes)
    .filter(TvEpisodeFilters.releasedEpisodes)
    .filter(TvEpisodeFilters.unwatchedEpisodes)
    .value().length;

  const numberOfEpisodes = _(episodes)
    .filter(TvEpisodeFilters.nonSpecialEpisodes)
    .filter(TvEpisodeFilters.withReleaseDateEpisodes)
    .filter(TvEpisodeFilters.releasedEpisodes)
    .value().length;

  const nextAiring =
    mediaItem.mediaType === 'tv'
      ? upcomingEpisode?.releaseDate
      : mediaItem.releaseDate;

  const lastAiring =
    mediaItem.mediaType === 'tv'
      ? lastAiredEpisode?.releaseDate
      : mediaItem.releaseDate;

  const seen =
    mediaItem.mediaType === 'tv'
      ? numberOfEpisodes > 0 && unseenEpisodesCount === 0
      : seenHistory && seenHistory?.length > 0;

  const lastSeen = _.first(seenHistory)?.date || null;

  const { poster, backdrop } = _.keyBy(
    images.filter((image) => !image.seasonId),
    (image) => image.type
  );

  const progressGroupedByDate = _(progress).groupBy('date');
  const progressValue = _.maxBy(
    progressGroupedByDate.get(progressGroupedByDate.keys().max()),
    'progress'
  )?.progress;

  return {
    ...mediaItem,
    platform: mediaItem.platform
      ? JSON.parse(mediaItem.platform as unknown as string)
      : null,
    hasDetails: true,
    genres: (mediaItem.genres as unknown as string)?.split(','),
    narrators: (mediaItem.narrators as unknown as string)?.split(','),
    authors: (mediaItem.authors as unknown as string)?.split(','),
    progress: progressValue !== 1 ? progressValue ?? null : null,
    seenHistory: seenHistory,
    seen: seen,
    seasons: seasons,
    upcomingEpisode: upcomingEpisode,
    lastAiredEpisode: lastAiredEpisode,
    firstUnwatchedEpisode: firstUnwatchedEpisode,
    userRating: userRating.find(UserRatingFilters.mediaItemUserRating) || null,
    onWatchlist: Boolean(watchlist),
    unseenEpisodesCount: unseenEpisodesCount,
    nextAiring: nextAiring,
    lastAiring: lastAiring,
    numberOfEpisodes: numberOfEpisodes,
    lastSeenAt: lastSeen,
    poster: poster?.id ? `/img/${poster?.id}` : null,
    posterSmall: poster?.id ? `/img/${poster?.id}?size=small` : null,
    backdrop: backdrop?.id ? `/img/${backdrop?.id}` : null,
  };
};
