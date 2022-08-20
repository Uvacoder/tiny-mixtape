import { Dispatch, Fragment, useCallback, useState } from "react";
import { Combobox, Transition } from "@headlessui/react";
import { CheckIcon, SelectorIcon, SearchIcon } from "@heroicons/react/solid";
import debounce from "lodash.debounce";
import { trpc } from "../../utils/trpc";
import { PlaylistTrack, TrackSeed } from "../../server/router/output-types";
import { UserAction, UserActionType } from "./new-playlist-state";

type AddPlaylistTrackProps = {
  dispatchUserAction: Dispatch<UserAction>;
};

export default function AddPlaylistTrack({
  dispatchUserAction,
}: AddPlaylistTrackProps) {
  const [selected, setSelected] = useState<PlaylistTrack | undefined>(
    undefined
  );
  const [query, setQuery] = useState("");
  const searchQuery = trpc.useQuery(
    ["spotify.searchForPlaylistTrack", { q: query, offset: 0, limit: 5 }],
    {
      refetchOnWindowFocus: false,
    }
  );

  const handleSearch = useCallback(
    debounce((q: string) => setQuery(q), 200),
    []
  );

  const onSelectTrack = (track: PlaylistTrack) => {
    dispatchUserAction({ type: UserActionType.ADD_TRACK, payload: track });
    setSelected(track);
  };

  const { data } = searchQuery;
  return (
    <Combobox
      as="div"
      className="lg:flex lg:flex-col lg:items-center pb-60"
      value={selected}
      onChange={onSelectTrack}
    >
      <Combobox.Label className="text-lg">Add track to mixtape</Combobox.Label>
      <div className="relative mt-1 w-full lg:w-1/3">
        <div className="relative cursor-default overflow-hidden rounded-lg bg-white text-left shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-teal-300 sm:text-sm">
          <Combobox.Input
            className="h-8 w-full border-none py-2 px-10 lg:px-14 text-sm lg:text-base text-gray-900 focus:ring-0 truncate disabled:cursor-not-allowed"
            displayValue={(track: TrackSeed) =>
              track ? `${track.name} • ${track.artists.join(", ")}` : ""
            }
            onChange={(e) => handleSearch(e.target.value)}
          />
          <div className="absolute inset-y-0 left-0 flex items-center px-2">
            <SearchIcon className="h-5 w-5 text-gray-400" aria-hidden />
          </div>
          <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
            <SelectorIcon className="h-5 w-5 text-gray-400" aria-hidden />
          </Combobox.Button>
        </div>
        {data && data.length > 0 && (
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Combobox.Options className="mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
              {data.map((track) => (
                <Combobox.Option
                  key={track.id}
                  className={({ active }) =>
                    `relative cursor-default select-none py-2 pl-10 pr-4 text-gray-900 ${
                      active ? "bg-gray-100" : "bg-white"
                    }`
                  }
                  value={track}
                >
                  {({ selected }) => (
                    <>
                      <span
                        className={`block truncate ${
                          selected ? "font-medium" : "font-normal"
                        }`}
                      >
                        {`${track.name} • ${track.artists.join(", ")}`}
                      </span>
                      {selected && (
                        <span
                          className={`absolute inset-y-0 left-0 flex items-center pl-3 spotify-green`}
                        >
                          <CheckIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      )}
                    </>
                  )}
                </Combobox.Option>
              ))}
            </Combobox.Options>
          </Transition>
        )}
      </div>
    </Combobox>
  );
}