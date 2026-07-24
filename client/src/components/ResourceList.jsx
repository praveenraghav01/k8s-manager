import React from 'react';

export default function ResourceList({ resources, selectedResource, onSelect, loading }) {
  const resourceTypes = ['pods', 'services', 'deployments', 'statefulSets', 'daemonSets'];

  return (
    <div className="resource-list">
      {loading && <h3 style={{ padding: '20px' }}>Loading...</h3>}
      {!loading && (
        <>
          {resourceTypes.map(type => {
            const items = resources[type] || [];
            if (items.length === 0) return null;

            return (
              <div key={type}>
                <h3>{type}</h3>
                <div className="resource-items">
                  {items.map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className={`resource-item ${
                        selectedResource?.name === item.name &&
                        selectedResource?.kind === item.kind
                          ? 'active'
                          : ''
                      }`}
                      onClick={() => onSelect(item)}
                    >
                      <div className="resource-kind">{item.kind}</div>
                      <div className="resource-name">{item.name}</div>
                      <div className="resource-status">{item.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
